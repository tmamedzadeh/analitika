/** Resumable per-source model reindexing, using the same atomic workers as normal ingestion. */
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import { dailyBriefs, documents } from "../src/server/db/schema";
import { requireServerEnv } from "../src/server/env";
import { processDocumentJob } from "../src/server/jobs/process-document";
import { indexBriefJob } from "../src/server/jobs/index-brief";
import { indexProgress } from "../src/server/jobs/index-state";
import { briefContentHash } from "../src/server/briefs/index-state";

const args = process.argv.slice(2);
if (args.some((arg) => !["--apply", "--dry-run", "--provider=gemini"].includes(arg)))
  throw new Error("Unsupported reindex argument.");
const apply = args.includes("--apply");
const model = requireServerEnv("GEMINI_EMBED_MODEL");
const db = getDb();
try {
  const documentRows = await db.select({ id: documents.id }).from(documents).where(sql`exists (
    select 1 from chunks c where c.document_id = ${documents.id} and (c.embedding_model <> ${model} or c.embedding is null)
  ) or ${documents.chunkCount} = 0`);
  const briefRows = await db
    .select({
      ...getTableColumns(dailyBriefs),
      version: sql<string>`${dailyBriefs.updatedAt}::text`,
    })
    .from(dailyBriefs).where(sql`exists (
    select 1 from chunks c where c.brief_id = ${dailyBriefs.id} and (c.embedding_model <> ${model} or c.embedding is null)
  ) or not exists (select 1 from chunks c where c.brief_id = ${dailyBriefs.id})`);
  let completed = 0;
  let failed = 0;
  if (apply) {
    for (const row of documentRows) {
      try {
        await processDocumentJob(row.id);
        completed++;
      } catch {
        failed++;
      }
    }
    for (const row of briefRows) {
      try {
        const [queued] = await db
          .update(dailyBriefs)
          .set({
            indexStatus: "queued",
            updatedAt: new Date(),
            indexProgress: {
              ...indexProgress(row.indexProgress),
              leaseId: null,
              recoveryAttempts: 0,
              ...(row.indexStatus === "ready" ? { contentHash: briefContentHash(row) } : {}),
            },
          })
          .where(
            and(
              eq(dailyBriefs.id, row.id),
              sql`${dailyBriefs.updatedAt}::text = ${row.version}`,
              sql`${dailyBriefs.indexStatus} <> 'processing'`,
            ),
          )
          .returning({ id: dailyBriefs.id });
        if (!queued) {
          failed++;
          continue;
        }
        await indexBriefJob(row.id);
        completed++;
      } catch {
        failed++;
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        model,
        documents: documentRows.length,
        briefs: briefRows.length,
        completed,
        failed,
      },
      null,
      2,
    ),
  );
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
