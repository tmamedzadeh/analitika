/** Bounded read-only migration preflight/verification. Never logs source content or credentials. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import "../src/server/env";

const phase = process.argv[2];
assert(phase === "before" || phase === "after", "Use before or after.");
const target = process.env["DATABASE_URL_MIGRATE"]?.trim();
const runtime = process.env["DATABASE_URL"]?.trim();
assert(target && runtime, "Both database URLs are required.");
const identity = (value: string) => {
  const url = new URL(value);
  return `${url.hostname}/${url.username}${url.pathname}`;
};
assert.equal(identity(target), identity(runtime), "Runtime and migration database targets differ.");
const targetFingerprint = createHash("sha256").update(identity(target)).digest("hex").slice(0, 16);
const knownProject = JSON.parse(
  await readFile("docs/release/BRIEF_CLASSIFICATION_MIGRATION.json", "utf8"),
);
assert.equal(
  targetFingerprint,
  knownProject.targetFingerprint,
  "Target differs from the previously verified project.",
);
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string; when: number }[];
};
assert.equal(journal.entries.at(-1)?.tag, "0026_brief_summary");
const evidencePath = ".release-backup.local/brief-summary-before.json";
const client = postgres(target, { prepare: false, max: 1, connect_timeout: 10 });
let stage = "connection";
try {
  const evidence = await client.begin("isolation level repeatable read read only", async (tx) => {
    await tx`set local statement_timeout = '20s'`;
    stage = "migration-history";
    const applied =
      await tx`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
    assert.equal(
      applied.length,
      phase === "before" ? 26 : 27,
      "Unexpected migration history; stop before proceeding.",
    );
    for (let index = 0; index < applied.length; index++) {
      const entry = journal.entries[index]!;
      const source = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
      const hashes = [
        migrations[index]!.hash,
        ...[source.replace(/\r\n/g, "\n"), source.replace(/\r?\n/g, "\r\n")].map((value) =>
          createHash("sha256").update(value).digest("hex"),
        ),
      ];
      assert.equal(
        String(applied[index]!["created_at"]),
        String(entry.when),
        "Migration order differs.",
      );
      assert(hashes.includes(String(applied[index]!["hash"])), "Applied migration hash differs.");
    }
    stage = "column";
    const columns =
      await tx`select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'daily_briefs' and column_name = 'summary'`;
    if (phase === "before") assert.equal(columns.length, 0, "Unexpected existing summary column.");
    else
      assert.deepEqual(
        [...columns],
        [{ data_type: "text", is_nullable: "YES", column_default: null }],
      );
    stage = "preservation-digests";
    const [briefs] = await tx`select count(*)::int as count,
      md5(coalesce(string_agg(md5((to_jsonb(b) - 'summary')::text), '|' order by id), '')) as digest
      from public.daily_briefs b`;
    const [chunks] = await tx`select count(*)::int as count, count(embedding)::int as embeddings,
      md5(coalesce(string_agg(md5(to_jsonb(c)::text), '|' order by id), '')) as digest from public.chunks c`;
    const [otherCounts] = await tx`select (select count(*)::int from public.documents) as documents,
      (select count(*)::int from public.brief_attachments) as brief_attachments`;
    stage = "summary-counts";
    const [summaries] =
      phase === "after"
        ? await tx`select count(*) filter (where summary is null or btrim(summary) = '')::int as empty,
        count(*) filter (where summary is not null and btrim(summary) <> '')::int as filled,
        count(*) filter (where char_length(summary) > 400)::int as too_long from public.daily_briefs`
        : [{ empty: briefs!["count"], filled: 0, too_long: 0 }];
    if (phase === "after") {
      const [constraint] =
        await tx`select convalidated, pg_get_constraintdef(oid) as definition from pg_constraint
        where conrelid = 'public.daily_briefs'::regclass and conname = 'daily_briefs_summary_length_check'`;
      assert.equal(constraint?.["convalidated"], true);
      assert.match(String(constraint?.["definition"]), /char_length\(summary\) <= 400/);
      assert.equal(summaries!["too_long"], 0);
    }
    return {
      targetFingerprint,
      appliedMigrationCount: applied.length,
      corpus: { briefs, chunks, otherCounts },
      summaries,
    };
  });
  if (phase === "before") {
    await mkdir(".release-backup.local", { recursive: true });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  } else {
    const before = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.equal(evidence.targetFingerprint, before.targetFingerprint);
    assert.deepEqual(evidence.corpus, before.corpus, "Existing data changed; stop and review.");
    assert.deepEqual(evidence.summaries, before.summaries, "Unexpected summary writes.");
    await writeFile(
      ".release-backup.local/brief-summary-after.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
  }
  console.log(
    JSON.stringify({
      phase,
      status: "PASS",
      targetMatchesKnownProject: true,
      runtimeTargetMatches: true,
      appliedMigrationCount: evidence.appliedMigrationCount,
      briefs: evidence.corpus.briefs!["count"],
      chunks: evidence.corpus.chunks!["count"],
      embeddings: evidence.corpus.chunks!["embeddings"],
      summaries: evidence.summaries,
      ...(phase === "after" ? { existingDataUnchanged: true } : {}),
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      reason:
        error instanceof assert.AssertionError
          ? error.message
          : "Database check failed; raw diagnostics withheld.",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
