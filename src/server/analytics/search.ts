import { and, asc, count, desc, eq, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";

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
import { accessFilter, documentAccessFilter } from "@/server/db/access";
import { attachments, briefAttachments, chunks, dailyBriefs, documents } from "@/server/db/schema";
import { documentConditions, minimumDocDate } from "./filters";
import { reciprocalRankFusion } from "./ranking";

const CANDIDATE_LIMIT = 50;
const RESULT_LIMIT = 10;
const RERANK_CANDIDATE_LIMIT = 30;
const MAX_VECTOR_DISTANCE = 0.4;
const AZERBAIJANI_STOP_WORDS = new Set([
  "amma",
  "barədə",
  "belə",
  "bir",
  "bu",
  "da",
  "də",
  "ilə",
  "kimi",
  "nə",
  "olan",
  "olaraq",
  "üçün",
  "və",
  "ya",
  "yaxud",
  "tərəfindən",
]);

export function buildFullTextQuery(query: string): string {
  const tokens = [
    ...new Set(
      query
        .normalize("NFKC")
        .toLocaleLowerCase("az")
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ]
    .filter((token) => token.length >= 3 && !AZERBAIJANI_STOP_WORDS.has(token))
    .slice(0, 12);
  return tokens.map((token) => (token.length > 5 ? `${token}:*` : token)).join(" | ");
}

export type SearchDocumentChunksOptions = {
  embedding?: number[];
  embeddingModel?: string;
  enableRerank?: boolean;
  maxEmbeddingAttempts?: 1 | 2 | 3;
  signal?: AbortSignal;
  rerankProvider?: RerankProvider;
};

function sourceProjection() {
  return {
    id: chunks.id,
    chunkId: chunks.id,
    sourceKind: sql<
      "document" | "brief"
    >`case when ${chunks.briefId} is null then 'document' else 'brief' end`,
    documentId: documents.id,
    briefId: dailyBriefs.id,
    title: sql<string>`coalesce(${documents.title}, ${dailyBriefs.title})`,
    docDate: documents.docDate,
    briefDate: dailyBriefs.briefDate,
    direction: documents.direction,
    sectionTitle: chunks.sectionTitle,
    text: chunks.text,
    charStart: chunks.charStart,
    charEnd: chunks.charEnd,
    isTable: chunks.isTable,
    tags: documents.tags,
    sourceReliability: documents.sourceReliability,
    infoCredibility: documents.infoCredibility,
    classification: documents.classification,
  };
}

export function searchSourceConditions(filters: AnalyticsFilters, now = new Date()) {
  const documentSource = and(isNotNull(chunks.documentId), ...documentConditions(filters, now));

  const briefConditions = [
    isNotNull(chunks.briefId),
    eq(dailyBriefs.status, "published"),
    eq(dailyBriefs.indexStatus, "ready"),
    accessFilter(),
  ];
  const fromDate = minimumDocDate(filters.period, now);
  if (fromDate) briefConditions.push(sql`${dailyBriefs.briefDate} >= ${fromDate}`);
  return or(documentSource, and(...briefConditions));
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
    (await providers.embeddings.embedQuery(query, {
      maxAttempts: options.maxEmbeddingAttempts ?? 1,
      ...(options.signal ? { signal: options.signal } : {}),
    }));
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
  const fullTextQuery = buildFullTextQuery(query);
  const tsQuery = sql`to_tsquery('simple'::regconfig, ${fullTextQuery})`;
  const textScore = sql`ts_rank_cd(${chunks.tsv}, ${tsQuery})` as SQL<number>;
  const similarity = sql.join([
    sql.raw("similarity("),
    chunks.text,
    sql.raw(", "),
    sql.param(query),
    sql.raw(")"),
  ]) as SQL<number>;
  const textMatch = fullTextQuery ? sql`${chunks.tsv} @@ ${tsQuery}` : sql`false`;
  const trigramMatch = sql.join([chunks.text, sql.raw(" % "), sql.param(query)]);
  const sourceCondition = searchSourceConditions(filters);
  const modelCondition = eq(chunks.embeddingModel, embeddingModel);

  const queryCandidates = (
    kind: "vector" | "text" | "trigram",
    sourceKind: "document" | "brief",
  ) => {
    const builder = db
      .select(sourceProjection())
      .from(chunks)
      .leftJoin(documents, eq(chunks.documentId, documents.id))
      .leftJoin(dailyBriefs, eq(chunks.briefId, dailyBriefs.id));
    const sourceKindCondition =
      sourceKind === "document" ? isNotNull(chunks.documentId) : isNotNull(chunks.briefId);
    const conditions = [sourceCondition, sourceKindCondition];
    if (kind === "vector") {
      conditions.push(
        modelCondition,
        isNotNull(chunks.embedding),
        lt(vectorDistance, MAX_VECTOR_DISTANCE),
      );
    }
    if (kind === "text") conditions.push(textMatch);
    if (kind === "trigram") conditions.push(trigramMatch);
    const selected = builder.where(and(...conditions));
    if (kind === "vector") return selected.orderBy(asc(vectorDistance)).limit(CANDIDATE_LIMIT);
    if (kind === "text") return selected.orderBy(desc(textScore)).limit(CANDIDATE_LIMIT);
    return selected.orderBy(desc(similarity)).limit(CANDIDATE_LIMIT);
  };

  const [
    documentVectorRows,
    documentFullTextRows,
    documentTrigramRows,
    briefVectorRows,
    briefFullTextRows,
    briefTrigramRows,
  ] = await Promise.all([
    queryCandidates("vector", "document"),
    queryCandidates("text", "document"),
    queryCandidates("trigram", "document"),
    queryCandidates("vector", "brief"),
    queryCandidates("text", "brief"),
    queryCandidates("trigram", "brief"),
  ]);

  const seenSources = new Set<string>();
  const candidates = reciprocalRankFusion(
    [
      documentVectorRows,
      documentFullTextRows,
      documentTrigramRows,
      briefVectorRows,
      briefFullTextRows,
      briefTrigramRows,
    ],
    60,
  )
    .filter(({ item }) => {
      const sourceKey =
        item.sourceKind === "brief"
          ? `brief:${item.briefId ?? item.chunkId}`
          : `document:${item.documentId ?? item.chunkId}`;
      if (seenSources.has(sourceKey)) return false;
      seenSources.add(sourceKey);
      return true;
    })
    .slice(0, RERANK_CANDIDATE_LIMIT);
  if (candidates.length === 0) return [];

  const rerankProvider =
    options.rerankProvider ??
    (config.enableRerank && config.lightModel
      ? new GeminiRerankProvider(new GeminiLLMProvider(config.lightModel, "AI_LIGHT_MODEL"))
      : undefined);
  const rerankedIds = await rerankOrderOrOriginal(
    query,
    candidates.map(({ item }) => ({ id: item.chunkId, excerpt: item.text.slice(0, 500) })),
    rerankProvider,
    options.enableRerank ?? config.enableRerank,
    undefined,
    options.signal,
  );
  const candidateById = new Map(candidates.map((candidate) => [candidate.item.chunkId, candidate]));
  const fused = rerankedIds
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is (typeof candidates)[number] => candidate !== undefined)
    .slice(0, RESULT_LIMIT);

  const documentIds = [
    ...new Set(fused.flatMap(({ item }) => (item.documentId ? [item.documentId] : []))),
  ];
  const briefIds = [...new Set(fused.flatMap(({ item }) => (item.briefId ? [item.briefId] : [])))];
  const [documentCounts, briefCounts] = await Promise.all([
    documentIds.length
      ? db
          .select({ id: attachments.documentId, total: count() })
          .from(attachments)
          .innerJoin(documents, eq(attachments.documentId, documents.id))
          .where(and(inArray(attachments.documentId, documentIds), documentAccessFilter()))
          .groupBy(attachments.documentId)
      : Promise.resolve([]),
    briefIds.length
      ? db
          .select({ id: briefAttachments.briefId, total: count() })
          .from(briefAttachments)
          .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
          .where(and(inArray(briefAttachments.briefId, briefIds), accessFilter()))
          .groupBy(briefAttachments.briefId)
      : Promise.resolve([]),
  ]);
  const countByDocument = new Map(documentCounts.map((row) => [row.id, Number(row.total)]));
  const countByBrief = new Map(briefCounts.map((row) => [row.id, Number(row.total)]));

  return fused.map(({ item }, index) => {
    const quote = item.text.replace(/\s+/g, " ").trim();
    const sourceKind = item.sourceKind as AnalyticsSource["sourceKind"];
    return {
      n: index + 1,
      sourceKind,
      chunkId: item.chunkId,
      documentId: item.documentId,
      briefId: item.briefId,
      title: item.title,
      docDate: item.docDate,
      briefDate: item.briefDate,
      direction: item.direction,
      sectionTitle: item.sectionTitle,
      text: item.text,
      quote: quote.length > 360 ? quote.slice(0, 357) + "…" : quote,
      charStart: item.charStart,
      charEnd: item.charEnd,
      isTable: item.isTable,
      attachmentCount:
        sourceKind === "brief"
          ? item.briefId
            ? (countByBrief.get(item.briefId) ?? 0)
            : 0
          : item.documentId
            ? (countByDocument.get(item.documentId) ?? 0)
            : 0,
      tags: item.tags ?? [],
      sourceReliability: item.sourceReliability as AnalyticsSource["sourceReliability"],
      infoCredibility: item.infoCredibility as AnalyticsSource["infoCredibility"],
      classification: sourceKind === "document" ? item.classification : "open",
    };
  });
}

export async function getAnalyticsOptions(): Promise<{ tags: string[] }> {
  const db = getDb();
  const rows = await db
    .select({ tags: documents.tags })
    .from(documents)
    .where(and(eq(documents.status, "ready"), documentAccessFilter()))
    .orderBy(desc(documents.createdAt), asc(documents.title))
    .limit(500);

  const tags = [...new Set(rows.flatMap((row) => row.tags))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "az"));
  return { tags };
}
