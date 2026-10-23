import { and, eq, lt, or, type SQL } from "drizzle-orm";

import { formatBriefEmbeddingText } from "@/lib/briefs";
import { systemAccessFilter } from "@/server/db/access";
import { getDb, type Database } from "@/server/db";
import { chunks, dailyBriefs } from "@/server/db/schema";
import { createGeminiProviders } from "@/server/ai/gemini";
import { chunkRichDocument } from "@/server/ingest/chunker";
import { isTemporaryWorkerFailure, nonRetriableJobError } from "./failure-policy";
import type { EmbeddingProvider } from "../ai/types";
import {
  INDEX_BATCH_TIMEOUT_MS,
  indexLeaseCondition,
  indexProgress,
  mergeIndexProgress,
  recoveryAttempts,
} from "./index-state";
import { briefContentHash } from "../briefs/index-state";

const EMBEDDING_BATCH_SIZE = 32;
export const BRIEF_INDEX_STALE_AFTER_MS = 15 * 60_000;

export function briefIndexClaimCondition(now = new Date()): SQL | undefined {
  const staleBefore = new Date(now.getTime() - BRIEF_INDEX_STALE_AFTER_MS);
  return or(
    eq(dailyBriefs.indexStatus, "queued"),
    eq(dailyBriefs.indexStatus, "failed"),
    and(eq(dailyBriefs.indexStatus, "processing"), lt(dailyBriefs.updatedAt, staleBefore)),
  );
}

type BriefIndexProgress = { percent: number; totalChunks: number; completedChunks: number };

export async function indexBriefJob(
  briefId: string,
  options: { embeddings?: EmbeddingProvider; database?: Database } = {},
): Promise<void> {
  const db = options.database ?? getDb();
  const leaseId = crypto.randomUUID();
  const lease = indexLeaseCondition(dailyBriefs.indexProgress, leaseId);
  const [brief] = await db
    .update(dailyBriefs)
    .set({
      indexStatus: "processing",
      indexProgress: mergeIndexProgress(dailyBriefs.indexProgress, {
        percent: 1,
        totalChunks: 0,
        completedChunks: 0,
        leaseId,
      }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyBriefs.id, briefId),
        eq(dailyBriefs.status, "published"),
        systemAccessFilter(),
        briefIndexClaimCondition(),
      ),
    )
    .returning();
  if (!brief) return;
  const attempts = recoveryAttempts(brief.indexProgress);
  const priorProgress = indexProgress(brief.indexProgress);

  try {
    const sourceChunks = chunkRichDocument(brief.bodyRich, brief.title);
    if (sourceChunks.length === 0) throw new Error("empty brief");
    await db
      .update(dailyBriefs)
      .set({
        indexProgress: {
          ...priorProgress,
          percent: 10,
          totalChunks: sourceChunks.length,
          completedChunks: 0,
          leaseId,
          recoveryAttempts: attempts,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dailyBriefs.id, briefId),
          eq(dailyBriefs.indexStatus, "processing"),
          lease,
          systemAccessFilter(),
        ),
      );

    const embeddings = options.embeddings ?? createGeminiProviders().embeddings;
    const prepared: Array<typeof chunks.$inferInsert> = [];
    for (let offset = 0; offset < sourceChunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = sourceChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const vectors = await embeddings.embedDocuments(
        batch.map((chunk) => formatBriefEmbeddingText(brief.title, brief.briefDate, chunk.text)),
        { signal: AbortSignal.timeout(INDEX_BATCH_TIMEOUT_MS) },
      );
      if (
        vectors.length !== batch.length ||
        vectors.some(
          (vector) =>
            vector.length !== 768 ||
            vector.some((value) => !Number.isFinite(value)) ||
            vector.every((value) => value === 0),
        )
      ) {
        throw new Error("brief embedding dimensions mismatch");
      }

      prepared.push(
        ...batch.map((chunk, index) => ({
          documentId: null,
          briefId,
          ord: chunk.ord,
          sectionTitle: chunk.sectionTitle,
          text: chunk.text,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          isTable: chunk.isTable,
          embedding: vectors[index]!,
          embeddingModel: embeddings.model,
        })),
      );
      const completedChunks = offset + batch.length;
      await db
        .update(dailyBriefs)
        .set({
          indexProgress: {
            ...priorProgress,
            percent: 10 + Math.floor((completedChunks / sourceChunks.length) * 85),
            totalChunks: sourceChunks.length,
            completedChunks,
            leaseId,
            recoveryAttempts: attempts,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dailyBriefs.id, briefId),
            eq(dailyBriefs.indexStatus, "processing"),
            lease,
            systemAccessFilter(),
          ),
        );
    }

    await db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ status: dailyBriefs.status, indexStatus: dailyBriefs.indexStatus })
        .from(dailyBriefs)
        .where(and(eq(dailyBriefs.id, briefId), lease, systemAccessFilter()))
        .for("update");
      if (!current || current.status !== "published" || current.indexStatus !== "processing") {
        return;
      }
      await transaction.delete(chunks).where(eq(chunks.briefId, briefId));
      await transaction.insert(chunks).values(prepared);
      await transaction
        .update(dailyBriefs)
        .set({
          indexStatus: "ready",
          indexProgress: {
            percent: 100,
            totalChunks: sourceChunks.length,
            completedChunks: sourceChunks.length,
            contentHash: briefContentHash(brief),
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dailyBriefs.id, briefId),
            eq(dailyBriefs.indexStatus, "processing"),
            lease,
            systemAccessFilter(),
          ),
        );
    });
  } catch (error) {
    await db
      .update(dailyBriefs)
      .set({
        indexStatus: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dailyBriefs.id, briefId),
          eq(dailyBriefs.indexStatus, "processing"),
          lease,
          systemAccessFilter(),
        ),
      );
    if (isTemporaryWorkerFailure(error)) throw error;
    throw nonRetriableJobError("Brief indexing failed.");
  }
}
