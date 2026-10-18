import postgres from "postgres";
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), "");
const databaseUrl = (process.env.DATABASE_URL_MIGRATE ?? env.DATABASE_URL_MIGRATE)?.trim();

if (!databaseUrl) throw new Error("DATABASE_URL_MIGRATE is required.");

const db = postgres(databaseUrl, { max: 1 });

try {
  const [extensions, tables, columns, constraints, indexes, briefDateUniqueIndexes] =
    await Promise.all([
      db.unsafe(
        "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm') ORDER BY extname",
      ),
      db.unsafe(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('daily_briefs', 'brief_attachments') ORDER BY table_name",
      ),
      db.unsafe(
        "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'chunks' AND column_name IN ('document_id', 'brief_id')) OR (table_name = 'daily_briefs' AND column_name IN ('status', 'index_status', 'index_progress')))",
      ),
      db.unsafe(
        "SELECT conname FROM pg_constraint WHERE conname IN ('chunks_source_check', 'brief_attachments_mime_check', 'brief_attachments_size_check', 'brief_attachments_ord_check') ORDER BY conname",
      ),
      db.unsafe(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('daily_briefs_status_date_idx', 'daily_briefs_title_trgm_idx', 'daily_briefs_body_trgm_idx', 'chunks_brief_idx', 'brief_attachments_brief_idx') ORDER BY indexname",
      ),
      db.unsafe(
        "SELECT c.conname AS name FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'brief_date' WHERE t.relname = 'daily_briefs' AND c.contype = 'u' AND c.conkey = ARRAY[a.attnum]::smallint[] UNION ALL SELECT i.indexrelid::regclass::text AS name FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'brief_date' WHERE t.relname = 'daily_briefs' AND i.indisunique AND i.indnatts = 1 AND i.indkey[0] = a.attnum",
      ),
    ]);

  const actual = {
    extensions: extensions.map((row) => String(row.extname)),
    tables: tables.map((row) => String(row.table_name)),
    columns: columns.map((row) => ({
      table: String(row.table_name),
      column: String(row.column_name),
      nullable: row.is_nullable === "YES",
    })),
    constraints: constraints.map((row) => String(row.conname)),
    indexes: indexes.map((row) => String(row.indexname)),
    briefDateUniqueIndexes: briefDateUniqueIndexes.map((row) => String(row.name)),
  };
  const missing = [
    ...["vector", "pg_trgm"].filter((item) => !actual.extensions.includes(item)),
    ...["daily_briefs", "brief_attachments"].filter((item) => !actual.tables.includes(item)),
    ...[
      "chunks_source_check",
      "brief_attachments_mime_check",
      "brief_attachments_size_check",
      "brief_attachments_ord_check",
    ].filter((item) => !actual.constraints.includes(item)),
    ...[
      "daily_briefs_title_trgm_idx",
      "daily_briefs_body_trgm_idx",
      "daily_briefs_status_date_idx",
      "chunks_brief_idx",
      "brief_attachments_brief_idx",
    ].filter((item) => !actual.indexes.includes(item)),
  ];
  const chunkColumns = new Map(
    actual.columns
      .filter((column) => column.table === "chunks")
      .map((column) => [column.column, column.nullable]),
  );
  if (chunkColumns.get("document_id") !== true || chunkColumns.get("brief_id") !== true) {
    missing.push("nullable chunks source columns");
  }
  if (actual.briefDateUniqueIndexes.length > 0) {
    missing.push(
      "no unique constraint/index on daily_briefs.brief_date (found " +
        actual.briefDateUniqueIndexes.join(", ") +
        ")",
    );
  }
  if (missing.length > 0) {
    console.error("Brief migration verification failed: " + missing.join("; "));
    process.exitCode = 1;
  } else {
    console.log(
      "Brief migration verified: extensions, tables, nullable sources, constraints, and indexes.",
    );
  }
} catch (error) {
  const failure = error as { code?: unknown; message?: unknown };
  const message = String(failure.message ?? "unknown database error").replaceAll(
    databaseUrl,
    "[redacted]",
  );
  console.error("Brief migration verification could not query the database.", {
    code: failure.code,
    message,
  });
  process.exitCode = 1;
} finally {
  await db.end();
}
