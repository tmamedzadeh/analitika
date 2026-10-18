import { and, asc, count, desc, eq, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";

import type { AnalyticsFilters, AnalyticsSource } from "@/lib/analytics";
import { getAppConfig } from "@/server/config";
import {
  GeminiRerankProvider,
  rerankOrderOrOriginal,
  type RerankProvider,
} from "@/server/ai/rerank";
import { GeminiLLMProvider } from "@/server/ai/gemini";
import { createGeminiProviders } from "@/server/ai/gemini";
import { getDb } from "@/server/db";
import { accessFilter } from "@/server/db/access";
import { attachments, chunks, documents } from "@/server/db/schema";
import { documentConditions } from "./filters";
import { reciprocalRankFusion } from "./ranking";

const CANDIDATE_LIMIT = 50;
const RESULT_LIMIT = 10;
const RERANK_CANDIDATE_LIMIT = 30;
const MAX_VECTOR_DISTANCE = 0.4;

export type SearchDocumentChunksOptions = {
  embedding?: number[];
  embeddingModel?: string;
  enableRerank?: boolean;
  maxEmbeddingAttempts?: 1 | 2 | 3;
  rerankProvider?: RerankProvider;
};

function sourceProjection() {
  return {
    id: chunks.id,
    chunkId: chunks.id,
    documentId: documents.id,
    title: documents.title,
    docDate: documents.docDate,
    department: documents.department,
    sectionTitle: chunks.sectionTitle,
    text: chunks.text,
    charStart: chunks.charStart,
    charEnd: chunks.charEnd,
    isTable: chunks.isTable,
    tags: documents.tags,
    sourceReliability: documents.sourceReliability,
    infoCredibility: documents.infoCredibility,
  };
}

export async function searchDocumentChunks(
  query: string,
  filters: AnalyticsFilters,
  options: SearchDocumentChunksOptions = {},
): Promise<AnalyticsSource[]> {
  const db = getDb();
  const providers = createGeminiProviders();
  const config = getAppConfig();
  const embeddingModel = options.embeddingModel ?? providers.embeddings.model;
  const embedding =
    options.embedding ??
    (await providers.embeddings.embedQuery(
      query,
      options.maxEmbeddingAttempts === undefined
        ? {}
        : { maxAttempts: options.maxEmbeddingAttempts },
    ));
  if (embedding.length !== 768 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("Query embedding must contain 768 finite dimensions.");
  }

  const vectorLiteral = "[" + embedding.join(",") + "]";
  const vectorDistance = sql.join([
    chunks.embedding,
    sql.raw(" <=> "),
    sql.param(vectorLiteral),
    sql.raw("::vector"),
  ]) as SQL<number>;
  const tsQuery = sql.join([
    sql.raw("plainto_tsquery('simple'::regconfig, "),
    sql.param(query),
    sql.raw(")"),
  ]);
  const textScore = sql.join([
    sql.raw("ts_rank("),
    chunks.tsv,
    sql.raw(", "),
    tsQuery,
    sql.raw(")"),
  ]) as SQL<number>;
  const similarity = sql.join([
    sql.raw("similarity("),
    chunks.text,
    sql.raw(", "),
    sql.param(query),
    sql.raw(")"),
  ]) as SQL<number>;
  const textMatch = sql.join([chunks.tsv, sql.raw(" @@ "), tsQuery]);
  const trigramMatch = sql.join([chunks.text, sql.raw(" % "), sql.param(query)]);
  const conditions = documentConditions(filters);
  const modelCondition = eq(chunks.embeddingModel, embeddingModel);

  const [vectorRows, fullTextRows, trigramRows] = await Promise.all([
    db
      .select(sourceProjection())
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(
        and(
          ...conditions,
          modelCondition,
          isNotNull(chunks.embedding),
          lt(vectorDistance, MAX_VECTOR_DISTANCE),
        ),
      )
      .orderBy(asc(vectorDistance))
      .limit(CANDIDATE_LIMIT),
    db
      .select(sourceProjection())
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(and(...conditions, modelCondition, textMatch))
      .orderBy(desc(textScore))
      .limit(CANDIDATE_LIMIT),
    db
      .select(sourceProjection())
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(and(...conditions, modelCondition, trigramMatch))
      .orderBy(desc(similarity))
      .limit(CANDIDATE_LIMIT),
  ]);

  const candidates = reciprocalRankFusion([vectorRows, fullTextRows, trigramRows], 60).slice(
    0,
    RERANK_CANDIDATE_LIMIT,
  );
  if (candidates.length === 0) return [];

  const rerankProvider =
    options.rerankProvider ??
    (config.enableRerank
      ? new GeminiRerankProvider(new GeminiLLMProvider(config.lightModel, "GEMINI_LIGHT_MODEL"))
      : undefined);
  const rerankedIds = await rerankOrderOrOriginal(
    query,
    candidates.map(({ item }) => ({ id: item.chunkId, excerpt: item.text.slice(0, 500) })),
    rerankProvider,
    options.enableRerank ?? config.enableRerank,
  );
  const candidateById = new Map(candidates.map((candidate) => [candidate.item.chunkId, candidate]));
  const fused = rerankedIds
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is (typeof candidates)[number] => candidate !== undefined)
    .slice(0, RESULT_LIMIT);

  const documentIds = [...new Set(fused.map(({ item }) => item.documentId))];
  const counts = await db
    .select({ documentId: attachments.documentId, total: count() })
    .from(attachments)
    .innerJoin(documents, eq(attachments.documentId, documents.id))
    .where(and(inArray(attachments.documentId, documentIds), accessFilter()))
    .groupBy(attachments.documentId);
  const countByDocument = new Map(counts.map((row) => [row.documentId, Number(row.total)]));

  return fused.map(({ item }, index) => {
    const quote = item.text.replace(/\s+/g, " ").trim();
    return {
      n: index + 1,
      chunkId: item.chunkId,
      documentId: item.documentId,
      title: item.title,
      docDate: item.docDate,
      department: item.department,
      sectionTitle: item.sectionTitle,
      text: item.text,
      quote: quote.length > 360 ? quote.slice(0, 357) + "…" : quote,
      charStart: item.charStart,
      charEnd: item.charEnd,
      isTable: item.isTable,
      attachmentCount: countByDocument.get(item.documentId) ?? 0,
      tags: item.tags,
      sourceReliability: item.sourceReliability as AnalyticsSource["sourceReliability"],
      infoCredibility: item.infoCredibility as AnalyticsSource["infoCredibility"],
    };
  });
}

export async function getAnalyticsOptions(): Promise<{ tags: string[] }> {
  const db = getDb();
  const rows = await db
    .select({
      tags: documents.tags,
    })
    .from(documents)
    .where(and(eq(documents.status, "ready"), accessFilter()))
    .orderBy(desc(documents.createdAt), asc(documents.title))
    .limit(500);

  const tags = [...new Set(rows.flatMap((row) => row.tags))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "az"));
  return {
    tags,
  };
}
