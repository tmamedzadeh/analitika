// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { analyticsFiltersSchema } from "@/lib/analytics";
import { directionIds } from "@/lib/directions";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { documentConditions } from "./filters";
import { searchSourceConditions } from "./search";
import { buildBriefListConditions } from "@/server/briefs/queries";
import { documentListConditions, documentListSchema } from "@/server/documents/queries";

const db = new PGlite("memory://");
const user: SessionUser = {
  id: "reader",
  username: "reader",
  role: "user",
  clearance: "open",
  sessionId: "synthetic",
};
const now = new Date("2026-10-21T15:00:00Z");
const day = { period: "custom" as const, from: "2026-10-21", to: "2026-10-21" };
const filters = (extra: object = {}) =>
  analyticsFiltersSchema.parse({ ...day, directionIds: [...directionIds], ...extra });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function select(table: string, where: ReturnType<typeof and>, order = "id") {
  const query = new PgDialect().sqlToQuery(where!);
  return (
    await db.query<{ id: string }>(
      `select ${table === "chunks" ? "chunks." : ""}id from ${table === "chunks" ? "chunks left join documents on chunks.document_id=documents.id left join daily_briefs on chunks.brief_id=daily_briefs.id" : table} where ${query.sql} order by ${order}`,
      query.params,
    )
  ).rows.map((row) => row.id);
}
beforeAll(async () => {
  await db.exec(`CREATE TABLE app_users (id text, active boolean, clearance text);
    INSERT INTO app_users VALUES ('reader', true, 'open');
    CREATE TABLE documents (id text, doc_date date, created_at timestamptz, direction text, source_reliability char(1), info_credibility smallint, classification text, chunk_count int);
    CREATE TABLE daily_briefs (id text, brief_date date, status text, index_status text, index_progress jsonb, title text, body text);
    CREATE TABLE chunks (id text, document_id text, brief_id text);`);
  const docs = [
    [1, "2026-10-21", "2026-10-20T19:59:59Z", "A", 1],
    [2, null, "2026-10-20T20:00:00Z", "B", 2],
    [3, null, "2026-10-21T19:59:59.999999Z", "B", 2],
    [4, null, "2026-10-21T20:00:00Z", "C", 3],
    [5, "2026-10-20", "2026-10-21T12:00:00Z", "A", 1],
    [6, "2026-10-21", "2026-10-21T12:00:00Z", null, null],
    [7, "2026-10-21", "2026-10-21T12:00:00Z", "C", 3],
  ];
  for (const [n, date, created, source, info] of docs) {
    await db.query("insert into documents values ($1,$2,$3,'OSINT',$4,$5,'open',1)", [
      id(Number(n)),
      date,
      created,
      source,
      info,
    ]);
    await db.query("insert into chunks values ($1,$2,null)", [`doc-${n}`, id(Number(n))]);
  }
  for (let n = 1; n <= 15; n++) {
    await db.query(
      "insert into daily_briefs values ($1,'2026-10-21','published','ready','{}','Synthetic','Synthetic')",
      [id(n + 100)],
    );
    await db.query("insert into chunks values ($1,null,$2)", [`brief-${n}`, id(n + 100)]);
  }
}, 30_000);
afterAll(() => db.close());

describe("real PostgreSQL unified date and exact set filtering", () => {
  it("uses the same inclusive Baku document window for catalog and analytics", async () => {
    const catalog = await withCurrentUser(user, () =>
      select("documents", and(...documentListConditions(documentListSchema.parse(day)))),
    );
    const analytics = await withCurrentUser(user, () =>
      select("documents", and(...documentConditions(filters(), now))),
    );
    expect(catalog).toEqual([1, 2, 3, 6, 7].map(id));
    expect(analytics).toEqual(catalog);
  });
  it("matches noncontiguous selected grades exactly and excludes NULL only when filtered", async () => {
    const result = await withCurrentUser(user, () =>
      select(
        "documents",
        and(
          ...documentConditions(
            filters({ sourceReliabilities: ["A", "C"], infoCredibilities: [1, 3] }),
            now,
          ),
        ),
      ),
    );
    expect(result).toEqual([id(1), id(7)]);
  });
  it("retains all briefs independently of document ratings and dispatches OFF conditions without brief access", async () => {
    const on = await withCurrentUser(user, () =>
      select(
        "chunks",
        searchSourceConditions(
          filters({ sourceReliabilities: ["E"], infoCredibilities: [5] }),
          now,
        ),
      ),
    );
    expect(on).toHaveLength(15);
    expect(on.every((value) => value.startsWith("brief-"))).toBe(true);
    const off = await withCurrentUser(user, () =>
      select(
        "chunks",
        searchSourceConditions(filters({ includeBriefs: false, sourceReliabilities: ["E"] }), now),
      ),
    );
    expect(off).toEqual([]);
  });
  it("combines document date/reliability filters with microsecond keyset pagination", async () => {
    const selected = documentListSchema.parse({
      ...day,
      sourceReliabilities: ["B"],
      cursor: { createdAt: "2026-10-21T19:59:59.999999Z", id: id(3) },
    });
    const result = await withCurrentUser(user, () =>
      select("documents", and(...documentListConditions(selected))),
    );
    expect(result).toEqual([id(2)]);
  });
  it("pages same-day briefs without duplicates while preserving the selected window", async () => {
    const first = await withCurrentUser(user, () =>
      select(
        "daily_briefs",
        and(...buildBriefListConditions({ ...day, query: "", cursor: null })),
        "id desc limit 12",
      ),
    );
    const next = await withCurrentUser(user, () =>
      select(
        "daily_briefs",
        and(
          ...buildBriefListConditions({
            ...day,
            query: "",
            cursor: { date: day.from, id: first.at(-1)! },
          }),
        ),
        "id desc limit 12",
      ),
    );
    expect(first).toHaveLength(12);
    expect(next).toHaveLength(3);
    expect(new Set([...first, ...next]).size).toBe(15);
  });
  it("fails closed after account deactivation", async () => {
    await db.exec("update app_users set active=false");
    try {
      expect(
        await withCurrentUser(user, () =>
          select("documents", and(...documentConditions(filters(), now))),
        ),
      ).toEqual([]);
      expect(
        await withCurrentUser(user, () =>
          select(
            "daily_briefs",
            and(...buildBriefListConditions({ ...day, query: "", cursor: null })),
          ),
        ),
      ).toEqual([]);
    } finally {
      await db.exec("update app_users set active=true");
    }
  });
  it("removes all date constraints for a new archive request while keeping ACL", async () => {
    await withCurrentUser(user, async () => {
      const full = filters({ period: "all", from: undefined, to: undefined });
      const documentSql = new PgDialect().sqlToQuery(and(...documentConditions(full, now))!).sql;
      const sourceSql = new PgDialect().sqlToQuery(searchSourceConditions(full, now)!).sql;
      expect(documentSql).not.toContain("doc_date");
      expect(sourceSql).not.toMatch(/"daily_briefs"\."brief_date"\s*(?:>=|<=|>|<)/);
      expect(documentSql).toContain('"app_users"."clearance"');
      expect(await select("documents", and(...documentConditions(full, now)))).toHaveLength(7);
    });
  });
});
