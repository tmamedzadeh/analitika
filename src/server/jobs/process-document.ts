import { and, eq } from "drizzle-orm";

import { createGeminiProviders } from "../ai/gemini";
import { getGeminiQuotaKey } from "../ai/gemini-gateway";
import { chunks, documents } from "../db/schema";
import { getDb } from "../db";
import { systemAccessFilter } from "../db/access";
import { chunkDocument } from "../ingest/chunker";
import { az } from "@/lib/i18n/az";
import { isTemporaryWorkerFailure, nonRetriableJobError } from "./failure-policy";

const EMBEDDING_BATCH_SIZE = 32;

type DocumentProgress = {
  percent: number;
  totalChunks: number;
  completedChunks: number;
};

function readableError(error: unknown): string {
  const quotaKey = getGeminiQuotaKey(error);
  const message = quotaKey
    ? az.documents.form.processingQuotaExceeded.replace("{quota}", quotaKey)
    : az.documents.form.processingErrorGeneric;
  return az.documents.form.processingErrorPrefix + message;
}

export async function processDocumentJob(documentId: string): Promise<void> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), systemAccessFilter()))
    .limit(1);
  if (!document || document.status === "ready") return;

  const now = new Date();
  await db.transaction(async (transaction) => {
    await transaction.delete(chunks).where(eq(chunks.documentId, documentId));
    await transaction
      .update(documents)
      .set({
        status: "processing",
        step: "chunking",
        chunkCount: 0,
        progress: { percent: 10, totalChunks: 0, completedChunks: 0 } satisfies DocumentProgress,
        error: null,
        updatedAt: now,
      })
      .where(eq(documents.id, documentId));
  });

  try {
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
        } satisfies DocumentProgress,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const embeddings = createGeminiProviders().embeddings;
    for (let offset = 0; offset < sourceChunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = sourceChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const vectors = await embeddings.embedDocuments(batch.map((chunk) => chunk.embeddingText));
      if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== 768)) {
        throw new Error("Aktiv embedding provayderi 768 ölçülü nəticə qaytarmadı.");
      }

      await db.insert(chunks).values(
        batch.map((chunk, index) => ({
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
          chunkCount: completedChunks,
          progress: {
            percent,
            totalChunks: sourceChunks.length,
            completedChunks,
          } satisfies DocumentProgress,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
    }

    await db
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
      .where(eq(documents.id, documentId));
  } catch (error) {
    await db
      .update(documents)
      .set({
        status: "failed",
        step: "failed",
        error: readableError(error),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    if (isTemporaryWorkerFailure(error)) throw error;
    throw nonRetriableJobError("Document indexing failed.");
  }
}
