import { readFile } from "node:fs/promises";
import process from "node:process";
import postgres from "postgres";

import "../src/server/env";

const migrationFiles = [
  "0000_stage_0.sql",
  "0001_stage_1_document_progress.sql",
  "0002_idare_departments.sql",
];
const migrationUrl = process.env.DATABASE_URL_MIGRATE?.trim();
if (!migrationUrl) throw new Error("DATABASE_URL_MIGRATE is required for migration verification.");

const db = postgres(migrationUrl, {
  max: 1,
  connect_timeout: 10,
});
const schemaName = `verify_idare_${crypto.randomUUID().replaceAll("-", "")}`;
const rollback = new Error("ROLLBACK_IDARE_MIGRATION_VERIFICATION");

function safeErrorDetails(error: unknown): string {
  const pending = [error];
  const parts: string[] = [];
  for (let depth = 0; pending.length > 0 && depth < 6; depth += 1) {
    const item = pending.shift();
    if (!(item instanceof Error)) continue;
    if (item.name) parts.push(item.name);
    if (item.message) parts.push(item.message);
    const details = item as Error & { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof details.code === "string") parts.push(details.code);
    if (details.cause) pending.push(details.cause);
    if (Array.isArray(details.errors)) pending.push(...details.errors);
  }
  return parts.join("; ").replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[connection URL redacted]");
}

async function runMigration(tx: postgres.TransactionSql, name: string): Promise<void> {
  const path = new URL(`../drizzle/${name}`, import.meta.url);
  const content = await readFile(path, "utf8");
  const statements = content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await tx.unsafe(statement);
}

try {
  try {
    await db.begin(async (tx) => {
      await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public, extensions`);
      await runMigration(tx, migrationFiles[0]!);
      await runMigration(tx, migrationFiles[1]!);

      const [legacyDocument] = await tx<{ id: string }[]>`
        INSERT INTO documents (title, body)
        VALUES ('Synthetic migration check', 'Synthetic migration body')
        RETURNING id
      `;
      const [legacyRequest] = await tx<{ id: string }[]>`
        INSERT INTO info_requests (department, request_date, urgency, purpose, details)
        VALUES ('İdarə 3', CURRENT_DATE, 'normal', 'Synthetic migration check', 'Synthetic')
        RETURNING id
      `;
      if (!legacyDocument || !legacyRequest) throw new Error("Could not create fixture rows.");

      await runMigration(tx, migrationFiles[2]!);

      const [document] = await tx<{ department: string | null }[]>`
        SELECT department FROM documents WHERE id = ${legacyDocument.id}
      `;
      const [request] = await tx<{ department: string }[]>`
        SELECT department FROM info_requests WHERE id = ${legacyRequest.id}
      `;
      const [column] = await tx<{ is_nullable: string }[]>`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schemaName}
          AND table_name = 'documents'
          AND column_name = 'department'
      `;
      const [departmentIndex] = await tx<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = ${schemaName}
          AND indexname = 'documents_department_idx'
      `;
      const [extensions] = await tx<{ total: number }[]>`
        SELECT count(*)::int AS total
        FROM pg_extension
        WHERE extname IN ('vector', 'pg_trgm')
      `;

      if (document?.department !== null)
        throw new Error("Existing documents must remain unassigned.");
      if (request?.department !== "d3")
        throw new Error("Legacy request department was not mapped.");
      if (column?.is_nullable !== "YES") throw new Error("documents.department must be nullable.");
      if (!departmentIndex) throw new Error("documents.department index is missing.");
      if (extensions?.total !== 2) throw new Error("Required database extensions are missing.");

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log("Clean-schema migration check passed; temporary schema was rolled back.");
} catch (error) {
  const details = safeErrorDetails(error) || "Unknown migration verification error.";
  console.error("Clean-schema migration check failed: " + details);
  process.exitCode = 1;
} finally {
  await db.end();
}
