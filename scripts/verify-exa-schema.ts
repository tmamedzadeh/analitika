import { sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/server/db";

async function verifySchema(): Promise<void> {
  const db = getDb();
  const extensionRows = await db.execute(sql`
    SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')
  `);
  const extensions = new Set(extensionRows.map((row) => String(row["extname"])));
  if (!extensions.has("vector") || !extensions.has("pg_trgm")) {
    throw new Error("Required PostgreSQL extensions are missing.");
  }

  const tableRows = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'documents', 'info_requests', 'request_attachments', 'osint_runs',
        'osint_sources', 'osint_cache', 'chunks', 'rate_limits'
      )
  `);
  const tables = new Set(tableRows.map((row) => String(row["table_name"])));
  const requiredTables = [
    "documents",
    "info_requests",
    "request_attachments",
    "osint_runs",
    "osint_sources",
    "osint_cache",
    "chunks",
    "rate_limits",
  ];
  if (requiredTables.some((table) => !tables.has(table))) {
    throw new Error("One or more required application tables are missing.");
  }

  const columnRows = await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'osint_runs' AND column_name = 'pinned') OR
        (table_name = 'osint_runs' AND column_name = 'heartbeat_at') OR
        (table_name = 'osint_sources' AND column_name = 'fetch_status') OR
        (table_name = 'documents' AND column_name = 'chunk_count')
      )
  `);
  const columns = new Set(columnRows.map((row) => `${row["table_name"]}.${row["column_name"]}`));
  const requiredColumns = [
    "osint_runs.pinned",
    "osint_runs.heartbeat_at",
    "osint_sources.fetch_status",
    "documents.chunk_count",
  ];
  if (requiredColumns.some((column) => !columns.has(column))) {
    throw new Error("One or more required application migrations are missing.");
  }

  console.log(
    "Database check passed: extensions, required tables, rate limits, OSINT columns, and document counts.",
  );
}

try {
  await verifySchema();
} catch {
  console.error("Database schema check failed. Confirm migrations and DATABASE_URL.");
  process.exitCode = 1;
} finally {
  await closeDb();
}
