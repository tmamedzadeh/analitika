import { and, eq } from "drizzle-orm";

import { az } from "@/lib/i18n/az";
import { formatBriefEmbeddingText } from "@/lib/briefs";
import { accessFilter } from "@/server/db/access";
import { getDb } from "@/server/db";
import { chunks, dailyBriefs } from "@/server/db/schema";
import { createGeminiProviders } from "@/server/ai/gemini";
import { chunkDocument } from "@/server/ingest/chunker";

const EMBEDDING_BATCH_SIZE = 32;

type BriefIndexProgress = { percent: number; totalChunks: number; completedChunks: number };

export async function indexBriefJob(briefId: string): Promise<void> {
  const db = getDb();
  const [brief] = await db
    .select()
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.id, briefId), accessFilter()))
    .limit(1);
  if (!brief) return;

  if (brief.status !== "published") {
    await db.transaction(async (transaction) => {
      await transaction.delete(chunks).where(eq(chunks.briefId, briefId));
      await transaction
        .update(dailyBriefs)
        .set({
          indexStatus: "none",
          indexProgress: { percent: 0, totalChunks: 0, completedChunks: 0 },
        })
        .where(and(eq(dailyBriefs.id, briefId), accessFilter()));
    });
    return;
  }

  await db.transaction(async (transaction) => {
    await transaction.delete(chunks).where(eq(chunks.briefId, briefId));
    await transaction
      .update(dailyBriefs)
      .set({
        indexStatus: "processing",
        indexProgress: {
          percent: 5,
          totalChunks: 0,
          completedChunks: 0,
        } satisfies BriefIndexProgress,
        updatedAt: new Date(),
      })
      .where(and(eq(dailyBriefs.id, briefId), accessFilter()));
  });

  try {
    const sourceChunks = chunkDocument(brief.body, brief.title);
    if (sourceChunks.length === 0) throw new Error("empty brief");
    await db
      .update(dailyBriefs)
      .set({
        indexProgress: { percent: 10, totalChunks: sourceChunks.length, completedChunks: 0 },
        updatedAt: new Date(),
      })
      .where(and(eq(dailyBriefs.id, briefId), accessFilter()));

    const embeddings = createGeminiProviders().embeddings;
    for (let offset = 0; offset < sourceChunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = sourceChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const vectors = await embeddings.embedDocuments(
        batch.map((chunk) => formatBriefEmbeddingText(brief.title, brief.briefDate, chunk.text)),
      );
      if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== 768)) {
        throw new Error("brief embedding dimensions mismatch");
      }

      await db.insert(chunks).values(
        batch.map((chunk, index) => ({
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
            percent: 10 + Math.floor((completedChunks / sourceChunks.length) * 85),
            totalChunks: sourceChunks.length,
            completedChunks,
          } satisfies BriefIndexProgress,
          updatedAt: new Date(),
        })
        .where(and(eq(dailyBriefs.id, briefId), accessFilter()));
    }

    await db
      .update(dailyBriefs)
      .set({
        indexStatus: "ready",
        indexProgress: {
          percent: 100,
          totalChunks: sourceChunks.length,
          completedChunks: sourceChunks.length,
        } satisfies BriefIndexProgress,
        updatedAt: new Date(),
      })
      .where(and(eq(dailyBriefs.id, briefId), accessFilter()));
  } catch {
    await db
      .update(dailyBriefs)
      .set({
        indexStatus: "failed",
        updatedAt: new Date(),
      })
      .where(and(eq(dailyBriefs.id, briefId), accessFilter()));
    throw new Error(az.briefs.indexStatus.failed);
  }
}
