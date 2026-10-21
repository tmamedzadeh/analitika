/** Live lexical/date/pagination/index verification; synthetic rows are always rolled back. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db";
import { dailyBriefs } from "../src/server/db/schema";
import { buildBriefListConditions } from "../src/server/briefs/queries";
import { BRIEF_PAGE_SIZE, getBakuDate } from "../src/lib/briefs";
import { withProjectEvaluationUser } from "../src/server/evaluation-safety";
import { getCurrentUser } from "../src/server/auth";

const token = `rclex${crypto.randomUUID().replaceAll("-", "")}`;
const rollback = new Error("Expected verification rollback");
const checks: string[] = [];
let normalIndexPlan = false;
let forcedIndexPlan = false;
try {
  await withProjectEvaluationUser(async () => {
    const ownerId = getCurrentUser().id;
    const today = getBakuDate();
    try {
      await getDb().transaction(async (tx) => {
        const fixtures = Array.from({ length: BRIEF_PAGE_SIZE + 5 }, (_, index) => ({
          id: crypto.randomUUID(),
          authorId: ownerId,
          briefDate: index % 2 ? today : "2020-01-01",
          title: `${token} ${index === 0 ? "Ə İ I Ş Ç Ğ Ö Ü" : index === 1 ? "İ" : index === 2 ? "I" : "catalogue"}`,
          body: "alfa distant text beta",
          status: "published",
          indexStatus: "none",
        }));
        await tx.insert(dailyBriefs).values(fixtures);
        const query = (
          text: string,
          cursor: { date: string; id: string } | null = null,
          month = "",
        ) =>
          tx
            .select({ id: dailyBriefs.id, date: dailyBriefs.briefDate })
            .from(dailyBriefs)
            .where(and(...buildBriefListConditions({ query: text, period: "all", month, cursor })))
            .orderBy(desc(dailyBriefs.briefDate), desc(dailyBriefs.id))
            .limit(BRIEF_PAGE_SIZE + 1);
        const dotted = (await query(`${token} i`)).map((row) => row.id);
        const dotless = (await query(`${token} ı`)).map((row) => row.id);
        assert.ok(dotted.includes(fixtures[1]!.id));
        assert.ok(!dotted.includes(fixtures[2]!.id));
        assert.ok(dotless.includes(fixtures[2]!.id));
        assert.ok(!dotless.includes(fixtures[1]!.id));
        for (const text of [
          `${token} ə i ı ş ç ğ ö ü`,
          `${token} O\u0308 U\u0308`,
          `${token} beta alfa`,
        ]) {
          assert.ok((await query(text)).length > 0);
        }
        assert.equal((await query(`${token} alfa missingword`)).length, 0);
        assert.equal((await query(`${token} a`)).length, 0);
        checks.push(
          "Azerbaijani case/NFC; distinct i/ı and ə/a; AND words across text; reversed word order",
        );
        const expected = [...fixtures]
          .sort((a, b) =>
            a.briefDate === b.briefDate
              ? a.id > b.id
                ? -1
                : 1
              : a.briefDate > b.briefDate
                ? -1
                : 1,
          )
          .map((row) => row.id);
        const first = (await query(token)).slice(0, BRIEF_PAGE_SIZE);
        const last = first.at(-1)!;
        const second = await query(token, last);
        assert.deepEqual(
          [...first, ...second].map((row) => row.id),
          expected,
        );
        assert.equal(new Set([...first, ...second].map((row) => row.id)).size, fixtures.length);
        assert.equal(
          (await query(token, null, today.slice(0, 7))).length,
          fixtures.filter((row) => row.briefDate === today).length,
        );
        checks.push(
          "Newest date/UUID ordering; actual page boundary; no duplicates/skips; month filter retained",
        );
        const target = query(`${token} Ə`);
        const normal = await tx.execute(sql`EXPLAIN (FORMAT JSON) ${target.getSQL()}`);
        normalIndexPlan = JSON.stringify(normal).includes("daily_briefs_search_gin_idx");
        await tx.execute(sql`SET LOCAL enable_seqscan = off`);
        const forced = await tx.execute(sql`EXPLAIN (FORMAT JSON) ${target.getSQL()}`);
        forcedIndexPlan = JSON.stringify(forced).includes("daily_briefs_search_gin_idx");
        assert.ok(forcedIndexPlan);
        checks.push(
          "Live GIN expression index usable by the actual catalogue predicate (forced planner check)",
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const remaining = await getDb()
      .select({ id: dailyBriefs.id })
      .from(dailyBriefs)
      .where(sql`${dailyBriefs.title} like ${token + "%"}`);
    assert.equal(remaining.length, 0);
  });
} catch (error) {
  console.error(
    JSON.stringify({ status: "FAIL", errorType: error instanceof Error ? error.name : "unknown" }),
  );
  process.exitCode = 1;
} finally {
  const result = {
    checkedAt: new Date().toISOString(),
    status: process.exitCode ? "FAIL" : "PASS",
    checks,
    normalIndexPlan,
    forcedIndexPlan,
    fixturePersistence: "transaction rolled back; no committed fixtures",
  };
  await writeFile("docs/release/LEXICAL_INTEGRATION.json", JSON.stringify(result, null, 2) + "\n");
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
