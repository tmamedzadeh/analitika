import { and, count, eq, inArray, isNotNull, lt, or, type SQL } from "drizzle-orm";

import { createGeminiProviders } from "../ai/gemini";
import { getGeminiQuotaKey } from "../ai/gemini-gateway";
import { chunks, documents } from "../db/schema";
import { getDb, type Database } from "../db";
import { systemAccessFilter } from "../db/access";
import { chunkDocument } from "../ingest/chunker";
import { az } from "@/lib/i18n/az";
import { isTemporaryWorkerFailure, nonRetriableJobError } from "./failure-policy";
import type { EmbeddingProvider } from "../ai/types";
import {
  INDEX_BATCH_TIMEOUT_MS,
  indexLeaseCondition,
  mergeIndexProgress,
  recoveryAttempts,
} from "./index-state";
import { assertExternalAiClassification, ExternalAiPolicyError } from "../ai/processing-policy";

const EMBEDDING_BATCH_SIZE = 32;
const EMBEDDING_DIMENSIONS = 768;
export const DOCUMENT_INDEX_STALE_AFTER_MS = 6 * 60_000;

export function documentIndexClaimCondition(now = new Date()): SQL | undefined {
  const staleBefore = new Date(now.getTime() - DOCUMENT_INDEX_STALE_AFTER_MS);
  return or(
    inArray(documents.status, ["queued", "failed", "ready"]),
    and(eq(documents.status, "processing"), lt(documents.updatedAt, staleBefore)),
  );
}

export function isValidDocumentEmbeddingBatch(
  vectors: readonly number[][],
  expectedCount: number,
  dimensions = EMBEDDING_DIMENSIONS,
): boolean {
  return (
    vectors.length === expectedCount &&
    vectors.every(
      (vector) =>
        vector.length === dimensions &&
        vector.every((value) => Number.isFinite(value)) &&
        vector.some((value) => value !== 0),
    )
  );
}

type DocumentProgress = {
  percent: number;
  totalChunks: number;
  completedChunks: number;
};

function readableError(error: unknown): string {
  if (error instanceof ExternalAiPolicyError) return az.documents.form.externalProcessingNotAllowed;
  const quotaKey = getGeminiQuotaKey(error);
  const message = quotaKey
    ? az.documents.form.processingQuotaExceeded.replace("{quota}", quotaKey)
    : az.documents.form.processingErrorGeneric;
  return az.documents.form.processingErrorPrefix + message;
}

export async function processDocumentJob(
  documentId: string,
  options: { embeddings?: EmbeddingProvider; database?: Database } = {},
): Promise<void> {
  const db = options.database ?? getDb();
  const [existing] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), systemAccessFilter()))
    .limit(1);
  if (!existing) return;

  if (existing.status === "ready") {
    const embeddingModel = (options.embeddings ?? createGeminiProviders().embeddings).model;
    const [allChunks] = await db
      .select({ total: count() })
      .from(chunks)
      .where(eq(chunks.documentId, documentId));
    const [currentChunks] = await db
      .select({ total: count() })
      .from(chunks)
      .where(
        and(
          eq(chunks.documentId, documentId),
          eq(chunks.embeddingModel, embeddingModel),
          isNotNull(chunks.embedding),
        ),
      );
    if (
      existing.chunkCount > 0 &&
      Number(allChunks?.total ?? 0) === existing.chunkCount &&
      Number(currentChunks?.total ?? 0) === existing.chunkCount
    ) {
      return;
    }
  }

  const now = new Date();
  const leaseId = crypto.randomUUID();
  const lease = indexLeaseCondition(documents.progress, leaseId);
  const [document] = await db
    .update(documents)
    .set({
      status: "processing",
      step: "chunking",
      progress: mergeIndexProgress(documents.progress, {
        percent: 10,
        totalChunks: 0,
        completedChunks: 0,
        leaseId,
      }),
      error: null,
      updatedAt: now,
    })
    .where(and(eq(documents.id, documentId), documentIndexClaimCondition(now)))
    .returning();
  // A duplicate delivery cannot take over a worker that is already processing.
  if (!document) return;
  const attempts = recoveryAttempts(document.progress);

  try {
    if (options.embeddings?.processingBoundary !== "local")
      assertExternalAiClassification(document.classification);
    const sourceChunks = chunkDocument(document.body, document.title);
    if (sourceChunks.length === 0)
      throw new Error("Sənəd mətnindən emal edilə bilən fraqment tapılmadı.");

    await db
      .update(documents)
      .set({
        step: "embedding",
        progress: {
          percent: 20,
          totalChunks: sourceChunks.length,
          completedChunks: 0,
          leaseId,
          recoveryAttempts: attempts,
        },
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.status, "processing"), lease));

    const embeddings = options.embeddings ?? createGeminiProviders().embeddings;
    const stagedRows: Array<typeof chunks.$inferInsert> = [];
    for (let offset = 0; offset < sourceChunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = sourceChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const vectors = await embeddings.embedDocuments(
        batch.map((chunk) => chunk.embeddingText),
        {
          signal: AbortSignal.timeout(INDEX_BATCH_TIMEOUT_MS),
        },
      );
      if (!isValidDocumentEmbeddingBatch(vectors, batch.length)) {
        throw new Error("Aktiv embedding provayderi uyğun olmayan vektor qaytardı.");
      }

      stagedRows.push(
        ...batch.map((chunk, index) => ({
          documentId,
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
      const percent = 20 + Math.floor((completedChunks / sourceChunks.length) * 70);
      await db
        .update(documents)
        .set({
          step: "embedding",
          progress: {
            percent,
            totalChunks: sourceChunks.length,
            completedChunks,
            leaseId,
            recoveryAttempts: attempts,
          },
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.status, "processing"), lease));
    }

    await db.transaction(async (transaction) => {
      const [lockedDocument] = await transaction
        .select({ id: documents.id, status: documents.status })
        .from(documents)
        .where(and(eq(documents.id, documentId), lease))
        .for("update")
        .limit(1);
      if (!lockedDocument || lockedDocument.status !== "processing") return;

      await transaction.delete(chunks).where(eq(chunks.documentId, documentId));
      for (let offset = 0; offset < stagedRows.length; offset += 200) {
        await transaction.insert(chunks).values(stagedRows.slice(offset, offset + 200));
      }
      await transaction
        .update(documents)
        .set({
          status: "ready",
          step: "ready",
          chunkCount: sourceChunks.length,
          progress: {
            percent: 100,
            totalChunks: sourceChunks.length,
            completedChunks: sourceChunks.length,
          } satisfies DocumentProgress,
          error: null,
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.status, "processing"), lease));
    });
  } catch (error) {
    await db
      .update(documents)
      .set({
        status: "failed",
        step: "failed",
        error: readableError(error),
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.status, "processing"), lease));
    if (isTemporaryWorkerFailure(error)) throw error;
    throw nonRetriableJobError("Document indexing failed.");
  }
}
