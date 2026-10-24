/** Explicitly authorized dev DB expand. Never logs connection strings or document contents. */
import postgres from "postgres";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import "../src/server/env";
import { verifyLiveSchema } from "./live-schema";

const apply = process.argv.includes("--apply");
const connection =
  process.env["DATABASE_URL_MIGRATE"]?.trim() || process.env["DATABASE_URL"]?.trim();
if (!connection) throw new Error("Configured development DB connection is required.");
const client = postgres(connection, { prepare: false, max: 1, connect_timeout: 10 });
try {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const entry = journal.entries.find(
    (e: { tag: string }) => e.tag === "0029_document_image_reliability_expand",
  );
  if (!entry || journal.entries.at(-1).idx !== 29) throw new Error("Migration journal conflict.");
  const migration = await readFile("drizzle/0029_document_image_reliability_expand.sql", "utf8");
  const hash = createHash("sha256").update(migration).digest("hex");
  const previousSql = await readFile("drizzle/0028_unified_contract.sql", "utf8");
  const previousHash = createHash("sha256").update(previousSql).digest("hex");
  await client.begin(async (tx) => {
    await tx`set local statement_timeout = '15s'`;
    await tx`set local lock_timeout = '2s'`;
    await tx`select pg_advisory_xact_lock(2920261024)`;
    const [identity] = await tx`select current_database() as db, current_user as role`;
    const migrations =
      await tx`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc`;
    const last = migrations[0];
    if (!last || ![previousHash, hash].includes(last.hash))
      throw new Error("Live migration journal does not match 0028/0029; refusing to apply.");
    const columns =
      await tx`select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('documents','attachments','brief_attachments','app_users')`;
    for (const [table, column] of [
      ["documents", "body_rich"],
      ["attachments", "image_metadata"],
      ["brief_attachments", "image_metadata"],
      ["app_users", "clearance"],
    ]) {
      if (!columns.some((r) => r.table_name === table && r.column_name === column))
        throw new Error("Incompatible predecessor schema.");
    }
    const existing =
      await tx`select tablename from pg_tables where schemaname='public' and tablename in ('document_creations','document_image_uploads','image_upload_objects')`;
    if (last.hash !== hash && existing.length)
      throw new Error("Partial/conflicting 0029 tables exist; refusing overwrite.");
    if (apply && last.hash !== hash) {
      for (const statement of migration.split("--> statement-breakpoint"))
        if (statement.trim()) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations(hash,created_at) values (${hash},${entry.when})`;
    }
    const after =
      await tx`select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in ('document_creations','document_image_uploads','image_upload_objects') order by tablename`;
    const constraints =
      await tx`select count(*)::int as count from pg_constraint where conrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname in ('document_creations','document_image_uploads','image_upload_objects'))`;
    console.log(
      JSON.stringify({
        configuredDevelopmentDatabase: true,
        identityPresent: Boolean(identity?.db && identity?.role),
        applied: apply && last.hash !== hash,
        alreadyApplied: last.hash === hash,
        previousJournalMatches: last.hash === previousHash,
        tables: after,
        constraints: constraints[0]?.count,
        existingRowsModified: false,
      }),
    );
    if (apply && (after.length !== 3 || after.some((r) => !r.rowsecurity)))
      throw new Error("0029 verification failed.");
  });
  const snapshot = JSON.parse(await readFile("drizzle/meta/0029_snapshot.json", "utf8"));
  const verification = await verifyLiveSchema(client, snapshot);
  console.log(JSON.stringify({ fullApplicationSchemaMismatches: verification.mismatches.length }));
  if (verification.mismatches.length) throw new Error("Application schema mismatch");
  const runtimeUrl = process.env["DATABASE_URL"]?.trim();
  if (!runtimeUrl) throw new Error("Runtime connection is missing");
  const runtime = postgres(runtimeUrl, { prepare: false, max: 1, connect_timeout: 10 });
  const probeKey = "zirve-local-schema-probe/" + crypto.randomUUID();
  let matches = false;
  let cleaned = false;
  await client`insert into public.image_upload_objects(key,generation,protect_until) values (${probeKey},1,now())`;
  try {
    const rows = await runtime`select key from public.image_upload_objects where key=${probeKey}`;
    matches = rows.length === 1;
  } finally {
    await runtime.end({ timeout: 5 });
    const removed =
      await client`delete from public.image_upload_objects where key=${probeKey} returning key`;
    cleaned = removed.length === 1;
  }
  const report = {
    migration: "0029_document_image_reliability_expand",
    fullApplicationSchemaMismatches: verification.mismatches.length,
    runtimeAndMigrationConnectionsShareSchema: matches,
    syntheticProbeCreated: 1,
    syntheticProbeCleaned: cleaned,
    existingRowsModified: false,
    s3ObjectsModified: false,
  };
  console.log(JSON.stringify(report));
  await writeFile("docs/release/ZIRVE_V1_DB_CHECKS.json", JSON.stringify(report, null, 2) + "\n");
  if (!matches || !cleaned) throw new Error("Runtime connection verification failed");
} catch (error) {
  console.error(
    JSON.stringify({
      status: "0029-verification-failed",
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
