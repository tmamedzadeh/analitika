/** Read-only native preflight plus rollback-only TEMP-table migration checks. No corpus copies/logs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import "../src/server/env";
import { verifyLiveSchema } from "./live-schema";

const target = process.env["DATABASE_URL_MIGRATE"]?.trim();
const runtime = process.env["DATABASE_URL"]?.trim();
assert(target && runtime, "Both configured database URLs are required.");
const identity = (value: string) => {
  const url = new URL(value);
  return `${url.hostname}/${url.username}${url.pathname}`;
};
assert.equal(identity(target), identity(runtime), "Runtime and migration database targets differ.");
const client = postgres(target, { max: 1, prepare: false, connect_timeout: 10 });
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string; when: number }[];
};
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
const migration = await readFile("drizzle/0024_brief_classification.sql", "utf8");
let stage = "journal";
try {
  const applied =
    await client`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
  assert([24, 25].includes(applied.length), "Unexpected applied migration count.");
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
      "Applied journal order mismatch.",
    );
    assert(hashes.includes(String(applied[index]!["hash"])), "Applied migration hash mismatch.");
  }
  const isApplied = applied.length === 25;
  const snapshot = JSON.parse(
    await readFile(`drizzle/meta/${isApplied ? "0024" : "0023"}_snapshot.json`, "utf8"),
  );
  stage = "native-schema";
  const native = await verifyLiveSchema(client, snapshot);
  assert.deepEqual(native.mismatches, [], "Live schema differs from the applied snapshot.");
  stage = "counts";
  const [counts] = await client`select count(*)::int as briefs,
    md5(coalesce(string_agg(md5((to_jsonb(b) - 'classification')::text), '|' order by id), '')) as unchanged_columns_digest
    from daily_briefs b`;
  const [classifications] = isApplied
    ? await client`select count(*)::int as total, count(*) filter (where classification = 'open')::int as open,
    count(*) filter (where classification is null or classification not in ('open','secret','top_secret','special'))::int as invalid from daily_briefs`
    : [];
  const tableCounts = await client`select (select count(*)::int from documents) as documents,
    (select count(*)::int from chunks) as chunks, (select count(*)::int from brief_attachments) as brief_attachments`;
  // Recreate only the pre-migration table shape in a transaction-local empty TEMP table.
  await client.begin(async (tx) => {
    stage = "temp-table";
    await tx`create temp table classification_migration_probe (like daily_briefs including all) on commit drop`;
    if (isApplied) await tx`alter table classification_migration_probe drop column classification`;
    await tx`insert into classification_migration_probe (brief_date,title,body,author_id) values ('2026-10-22','Synthetic migration fixture','Invented fixture','synthetic')`;
    for (const statement of migration.split("--> statement-breakpoint")) {
      stage = "temp-migration";
      await tx.unsafe(statement.replaceAll('"daily_briefs"', '"classification_migration_probe"'));
    }
    const [legacy] =
      await tx`select classification, title, body, author_id from classification_migration_probe`;
    stage = "temp-constraints";
    assert.equal(legacy!["classification"], "open");
    assert.equal(legacy!["title"], "Synthetic migration fixture");
    assert.equal(legacy!["body"], "Invented fixture");
    assert.equal(legacy!["author_id"], "synthetic");
    await tx`insert into classification_migration_probe (brief_date,title,body,author_id) values ('2026-10-22','New synthetic fixture','Invented','synthetic')`;
    for (const classification of ["open", "secret", "top_secret", "special"])
      await tx`update classification_migration_probe set classification = ${classification}`;
    for (const classification of [null, "invalid"]) {
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`update classification_migration_probe set classification = ${classification}`;
        }),
        { code: classification === null ? "23502" : "23514" },
      );
    }
  });
  const evidence = {
    capturedAt: new Date().toISOString(),
    targetFingerprint: createHash("sha256").update(identity(target)).digest("hex").slice(0, 16),
    runtimeTargetMatches: true,
    appliedMigrationCount: applied.length,
    journalHashesMatch: true,
    nativeSchemaMatches: true,
    migration: "0024_brief_classification.sql",
    status: isApplied ? "APPLIED" : "NOT APPLIED",
    tempMigrationChecks: "PASS",
    counts,
    classifications: classifications ?? null,
    tableCounts,
  };
  await writeFile(
    process.argv[2] ?? "docs/release/BRIEF_CLASSIFICATION_MIGRATION.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      errorType: error instanceof Error ? error.name : "unknown",
      reason:
        error instanceof assert.AssertionError
          ? error.message
          : "Migration preflight failed; raw database diagnostics withheld.",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
