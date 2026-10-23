import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { AnalyticsSource } from "@/lib/analytics";
import { AuthorizationError } from "@/server/auth";
import { chunks } from "@/server/db/schema";
import type { AnalyticsTransaction } from "./source-access";
import { EVIDENCE_CHUNK_LIMIT } from "./evidence-limits";
import { CONTEXT_NEIGHBOR_LIMIT } from "./context-selection";

export const CONTEXT_FINGERPRINT_LIMIT = EVIDENCE_CHUNK_LIMIT + CONTEXT_NEIGHBOR_LIMIT;

export const contextChunkProjection = {
  id: chunks.id,
  documentId: chunks.documentId,
  briefId: chunks.briefId,
  text: chunks.text,
  charStart: chunks.charStart,
  charEnd: chunks.charEnd,
  ord: chunks.ord,
  sectionTitle: chunks.sectionTitle,
  isTable: chunks.isTable,
  embeddingModel: chunks.embeddingModel,
};
export type AnalyticsContextChunk = {
  id: string;
  documentId: string | null;
  briefId: string | null;
  text: string;
  charStart: number;
  charEnd: number;
  ord: number;
  sectionTitle: string;
  isTable: boolean;
  embeddingModel: string;
};
export type AnalyticsAuxiliaryContext = {
  anchorChunkId: string;
  position: "before" | "after";
  chunk: AnalyticsContextChunk;
  text: string;
};
export type AnalyticsContext = {
  primary: AnalyticsContextChunk[];
  auxiliary: AnalyticsAuxiliaryContext[];
};

export const contextFingerprintSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  briefId: z.string().uuid().nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ContextFingerprint = z.infer<typeof contextFingerprintSchema>;
export function contextFingerprint(chunk: AnalyticsContextChunk): ContextFingerprint {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    briefId: chunk.briefId,
    digest: createHash("sha256")
      .update(
        JSON.stringify([
          chunk.id,
          chunk.documentId,
          chunk.briefId,
          chunk.text,
          chunk.charStart,
          chunk.charEnd,
          chunk.ord,
          chunk.sectionTitle,
          chunk.isTable,
          chunk.embeddingModel,
        ]),
      )
      .digest("hex"),
  };
}
export function contextChunks(context: AnalyticsContext): AnalyticsContextChunk[] {
  return [...context.primary, ...context.auxiliary.map((item) => item.chunk)];
}
export function matchesPrimary(source: AnalyticsSource, chunk: AnalyticsContextChunk): boolean {
  return (
    source.chunkId === chunk.id &&
    source.documentId === chunk.documentId &&
    source.briefId === chunk.briefId &&
    source.text === chunk.text &&
    source.charStart === chunk.charStart &&
    source.charEnd === chunk.charEnd &&
    source.sectionTitle === chunk.sectionTitle &&
    source.isTable === chunk.isTable
  );
}
export function sameContextChunk(
  expected: AnalyticsContextChunk,
  actual: AnalyticsContextChunk,
): boolean {
  return contextFingerprint(expected).digest === contextFingerprint(actual).digest;
}

/** Parent/account locks are already held by readLockedAnalyticsSources. */
export async function assertLockedAnalyticsContext(
  transaction: AnalyticsTransaction,
  sources: readonly AnalyticsSource[],
  expected: readonly AnalyticsContextChunk[],
): Promise<void> {
  if (
    expected.length > CONTEXT_FINGERPRINT_LIMIT ||
    new Set(expected.map((item) => item.id)).size !== expected.length ||
    sources.some((source) => !expected.some((chunk) => matchesPrimary(source, chunk))) ||
    expected.some(
      (chunk) =>
        !sources.some(
          (source) => source.documentId === chunk.documentId && source.briefId === chunk.briefId,
        ),
    )
  )
    throw new AuthorizationError();
  const current = await transaction
    .select(contextChunkProjection)
    .from(chunks)
    .where(
      inArray(
        chunks.id,
        expected.map((item) => item.id),
      ),
    )
    .for("share");
  const byId = new Map(current.map((item) => [item.id, item]));
  if (expected.some((item) => !byId.has(item.id) || !sameContextChunk(item, byId.get(item.id)!)))
    throw new AuthorizationError();
}
