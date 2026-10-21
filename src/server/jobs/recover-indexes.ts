import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { dailyBriefs, documents } from "../db/schema";
import { az } from "@/lib/i18n/az";
import { DOCUMENT_INDEX_STALE_AFTER_MS } from "./process-document";
import { BRIEF_INDEX_STALE_AFTER_MS } from "./index-brief";
import { indexProgress, recoveryAttempts } from "./index-state";

export const MAX_RECOVERY_ATTEMPTS = 5;

export async function recoverPendingDocuments(
  send: (documentId: string) => Promise<unknown>,
  sourceIds?: readonly string[],
) {
  const db = getDb();
  const now = new Date();
  const stale = new Date(now.getTime() - DOCUMENT_INDEX_STALE_AFTER_MS);
  const rows = await db
    .select({
      id: documents.id,
      status: documents.status,
      progress: documents.progress,
      version: sql<string>`${documents.updatedAt}::text`,
    })
    .from(documents)
    .where(
      and(
        sourceIds ? inArray(documents.id, [...sourceIds]) : undefined,
        or(
          and(eq(documents.status, "queued"), lt(documents.updatedAt, stale)),
          and(eq(documents.status, "processing"), lt(documents.updatedAt, stale)),
          and(
            eq(documents.status, "failed"),
            lt(documents.updatedAt, new Date(now.getTime() - 30 * 60_000)),
          ),
        ),
      ),
    )
    .orderBy(asc(documents.updatedAt))
    .limit(100);
  let queued = 0;
  let exhausted = 0;
  for (const row of rows) {
    const attempts = recoveryAttempts(row.progress);
    if (row.status === "failed" && attempts >= MAX_RECOVERY_ATTEMPTS) continue;
    const terminal = attempts >= MAX_RECOVERY_ATTEMPTS;
    const [claimed] = await db
      .update(documents)
      .set({
        status: terminal ? "failed" : "queued",
        step: terminal ? "failed" : "queued",
        error: terminal ? az.documents.form.processingErrorGeneric : null,
        progress: {
          ...indexProgress(row.progress),
          leaseId: null,
          recoveryAttempts: terminal ? attempts : attempts + 1,
          recoveryExhausted: terminal,
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(documents.id, row.id),
          eq(documents.status, row.status),
          sql`${documents.updatedAt}::text = ${row.version}`,
        ),
      )
      .returning({ id: documents.id });
    if (!claimed) continue;
    if (terminal) {
      exhausted += 1;
      continue;
    }
    try {
      await send(row.id);
      queued += 1;
    } catch {
      /* Durable queued state is retried next cycle. */
    }
  }
  return { considered: rows.length, queued, exhausted };
}

export async function recoverPendingBriefs(
  send: (briefId: string) => Promise<unknown>,
  sourceIds?: readonly string[],
) {
  const db = getDb();
  const now = new Date();
  const stale = new Date(now.getTime() - BRIEF_INDEX_STALE_AFTER_MS);
  const rows = await db
    .select({
      id: dailyBriefs.id,
      status: dailyBriefs.indexStatus,
      progress: dailyBriefs.indexProgress,
      version: sql<string>`${dailyBriefs.updatedAt}::text`,
    })
    .from(dailyBriefs)
    .where(
      and(
        sourceIds ? inArray(dailyBriefs.id, [...sourceIds]) : undefined,
        eq(dailyBriefs.status, "published"),
        or(
          and(eq(dailyBriefs.indexStatus, "queued"), lt(dailyBriefs.updatedAt, stale)),
          and(eq(dailyBriefs.indexStatus, "processing"), lt(dailyBriefs.updatedAt, stale)),
          and(
            eq(dailyBriefs.indexStatus, "failed"),
            lt(dailyBriefs.updatedAt, new Date(now.getTime() - 30 * 60_000)),
          ),
        ),
      ),
    )
    .orderBy(asc(dailyBriefs.updatedAt))
    .limit(100);
  let queued = 0;
  let exhausted = 0;
  for (const row of rows) {
    const attempts = recoveryAttempts(row.progress);
    if (row.status === "failed" && attempts >= MAX_RECOVERY_ATTEMPTS) continue;
    const terminal = attempts >= MAX_RECOVERY_ATTEMPTS;
    const [claimed] = await db
      .update(dailyBriefs)
      .set({
        indexStatus: terminal ? "failed" : "queued",
        indexProgress: {
          ...indexProgress(row.progress),
          leaseId: null,
          recoveryAttempts: terminal ? attempts : attempts + 1,
          recoveryExhausted: terminal,
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(dailyBriefs.id, row.id),
          eq(dailyBriefs.indexStatus, row.status),
          sql`${dailyBriefs.updatedAt}::text = ${row.version}`,
        ),
      )
      .returning({ id: dailyBriefs.id });
    if (!claimed) continue;
    if (terminal) {
      exhausted += 1;
      continue;
    }
    try {
      await send(row.id);
      queued += 1;
    } catch {
      /* Durable queued state is retried next cycle. */
    }
  }
  return { considered: rows.length, queued, exhausted };
}
