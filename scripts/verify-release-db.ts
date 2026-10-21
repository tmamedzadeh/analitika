/** Read-only release evidence. Never emits credentials, titles, bodies, or raw errors. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { closeDb, getDb } from "../src/server/db";

const output = process.argv[2];
let stage = "configuration";
try {
  const db = getDb();
  stage = "local-migrations";
  const migrations = readMigrationFiles({ migrationsFolder: resolve("drizzle") });
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  stage = "database-connection";
  const applied = await db.execute(
    sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
  );
  const checksums = await Promise.all(
    journal.entries.map(async (entry, index) => {
      const source = await readFile(resolve("drizzle", entry.tag + ".sql"), "utf8");
      const recorded = applied.find((row) => String(row["created_at"]) === String(entry.when));
      const exact = recorded?.["hash"] === migrations[index]?.hash;
      const lineEndingEquivalent = [
        source.replace(/\r\n/gu, "\n"),
        source.replace(/\r?\n/gu, "\r\n"),
      ].some((value) => createHash("sha256").update(value).digest("hex") === recorded?.["hash"]);
      return {
        tag: entry.tag,
        applied: Boolean(recorded),
        hashMatches: Boolean(recorded) && (exact || lineEndingEquivalent),
        hashFormat: !recorded
          ? "not-applied"
          : exact
            ? "exact"
            : lineEndingEquivalent
              ? "line-endings-only"
              : "MISMATCH",
      };
    }),
  );
  stage = "database-inspection";
  const results = {
    capturedAt: new Date().toISOString(),
    migrations: checksums,
    appliedMigrationCount: applied.length,
    database: await db.execute(
      sql`select version(), current_setting('TimeZone') as timezone, current_date as date, now() as time`,
    ),
    serverAccessAfterRls: await db.execute(
      sql`select bool_and(c.relowner = (select oid from pg_roles where rolname = current_user) or (select rolbypassrls or rolsuper from pg_roles where rolname = current_user)) as bypasses_rls_on_all_app_tables from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
    ),
    counts: await db.execute(
      sql`select (select count(*)::int from documents) as documents, (select count(*)::int from daily_briefs) as briefs, (select count(*)::int from chunks) as chunks, (select count(embedding)::int from chunks) as embeddings, (select count(*)::int from query_logs) as history`,
    ),
    documents: await db.execute(
      sql`select d.id, d.classification, d.status, d.step, d.chunk_count, d.created_at, d.updated_at, length(d.body) as body_chars, d.error is not null as has_error, d.progress, count(c.id)::int as actual_chunks, count(c.embedding)::int as embeddings from documents d left join chunks c on c.document_id = d.id group by d.id order by d.created_at desc`,
    ),
    briefs: await db.execute(
      sql`select b.id, b.status, b.index_status, b.index_progress, b.created_at, b.updated_at, count(c.id)::int as chunks, count(c.embedding)::int as embeddings from daily_briefs b left join chunks c on c.brief_id = b.id group by b.id order by b.created_at desc`,
    ),
    integrity: await db.execute(
      sql`select count(*) filter (where (document_id is null) = (brief_id is null))::int as invalid_parent, count(*) filter (where embedding is null)::int as missing_embeddings, count(*) filter (where vector_dims(embedding) <> 768)::int as invalid_dimensions, count(*) filter (where char_start < 0 or char_end <= char_start)::int as invalid_offsets, (select count(*)::int from (select document_id, brief_id, ord from chunks group by document_id, brief_id, ord having count(*) > 1) d) as duplicate_ordinals, (select count(*)::int from chunks c left join documents d on d.id = c.document_id left join daily_briefs b on b.id = c.brief_id where d.id is null and b.id is null) as orphans from chunks`,
    ),
    embeddings: await db.execute(
      sql`select embedding_model, vector_dims(embedding) as dimensions, count(*)::int from chunks group by embedding_model, vector_dims(embedding)`,
    ),
    extensions: await db.execute(
      sql`select extname, extversion from pg_extension order by extname`,
    ),
    tables: await db.execute(
      sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`,
    ),
    clientPrivileges: await db.execute(
      sql`select r.rolname as role, c.relname as table_name, has_table_privilege(r.oid, c.oid, 'SELECT') as can_read, has_table_privilege(r.oid, c.oid, 'INSERT,UPDATE,DELETE') as can_write from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace where r.rolname in ('anon', 'authenticated') and n.nspname = 'public' and c.relkind = 'r' order by r.rolname, c.relname`,
    ),
    columns: await db.execute(
      sql`select table_name, column_name, data_type, udt_name, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
    ),
    indexes: await db.execute(
      sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname`,
    ),
    constraints: await db.execute(
      sql`select c.conrelid::regclass::text as table_name, c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' order by table_name, c.conname`,
    ),
    triggers: await db.execute(
      sql`select event_object_table, trigger_name from information_schema.triggers where trigger_schema = 'public' order by event_object_table, trigger_name`,
    ),
    legacyHistory: await db.execute(
      sql`select count(*)::int as rows from query_logs where filters ? 'tag' or filters ? 'tags'`,
    ),
  };
  if (output) await writeFile(output, JSON.stringify(results, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        capturedAt: results.capturedAt,
        output,
        counts: results.counts,
        migrationCount: results.appliedMigrationCount,
        pendingMigrations: results.migrations.filter((entry) => !entry.applied),
        checksumMismatches: results.migrations.filter(
          (entry) => entry.applied && !entry.hashMatches,
        ),
        integrity: results.integrity,
        serverAccessAfterRls: results.serverAccessAfterRls,
        protectedTables: results.tables.filter((row) => row["rowsecurity"]).length,
        readableClientTables: results.clientPrivileges.filter((row) => row["can_read"]).length,
        writableClientTables: results.clientPrivileges.filter((row) => row["can_write"]).length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  const message = error instanceof Error ? error.message : "";
  const safeMessage = /^Missing required environment variable: [A-Z0-9_]+$/u.test(message)
    ? message
    : undefined;
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      errorType: error instanceof Error ? error.name : "unknown",
      code,
      safeMessage,
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
