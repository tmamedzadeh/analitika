import { buildLexicalQuery, matchesNamedEntities } from "@/server/search/lexical";
import { lexicalSearchSql } from "@/server/search/sql";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { AnalyticsFilters, AnalyticsSource } from "@/lib/analytics";
import { getAppConfig } from "@/server/config";
import {
  GeminiRerankProvider,
  rerankOrderOrOriginal,
  type RerankProvider,
} from "@/server/ai/rerank";
import { createGeminiProviders } from "@/server/ai/gemini";
import { getDb } from "@/server/db";
import { briefAccessFilter, documentAccessFilter, getCurrentUser } from "@/server/db/access";
import { attachments, briefAttachments, chunks, dailyBriefs, documents } from "@/server/db/schema";
import { documentConditions, hasCommittedDocumentIndex, minimumDocDate } from "./filters";
import { reciprocalRankFusion, resolveQueryEmbedding, settleRetrievalBranches } from "./ranking";
import {
  assertAnalyticsQueryAccess,
  assertAnalyticsQuestionAccess,
  requireAnalyticsSourceAccess,
  withAnalyticsSourceAccess,
} from "./source-access";
import { hasCommittedBriefIndex } from "../briefs/index-state";
import { getBakuDate } from "@/lib/briefs";
import { withAiDiagnostics } from "@/server/ai/diagnostics";
import { selectAnalyticsEvidence } from "./evidence-selection";

const CANDIDATE_LIMIT = 50;
const RERANK_CANDIDATE_LIMIT = 30;
const MAX_VECTOR_DISTANCE = 0.4;
export function buildFullTextQuery(query: string): string {
  return buildLexicalQuery(query, "any", true);
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
    sourceReliability: documents.sourceReliability,
    infoCredibility: documents.infoCredibility,
    classification: sql<string>`coalesce(${documents.classification}, ${dailyBriefs.classification})`,
  };
}

export function searchSourceConditions(filters: AnalyticsFilters, now = new Date()) {
  const documentSource = and(isNotNull(chunks.documentId), ...documentConditions(filters, now));
  if (!filters.includeBriefs) return documentSource;
  const briefConditions = [
    isNotNull(chunks.briefId),
    eq(dailyBriefs.status, "published"),
    hasCommittedBriefIndex(),
    briefAccessFilter(),
  ];
  const fromDate = minimumDocDate(filters.period, now);
  if (fromDate) briefConditions.push(sql`${dailyBriefs.briefDate} >= ${fromDate}`);
  briefConditions.push(lte(dailyBriefs.briefDate, getBakuDate(now)));
  return or(documentSource, and(...briefConditions));
}

export async function searchDocumentChunks(
  query: string,
  filters: AnalyticsFilters,
  options: SearchDocumentChunksOptions = {},
): Promise<AnalyticsSource[]> {
  options.signal?.throwIfAborted();
  const db = getDb();
  const providers = createGeminiProviders();
  const config = getAppConfig();
  const currentUser = getCurrentUser();
  await assertAnalyticsQueryAccess(currentUser);
  options.signal?.throwIfAborted();
  const embeddingModel = options.embeddingModel ?? providers.embeddings.model;
  const embeddingResolution = await resolveQueryEmbedding({
    ...(options.embedding ? { provided: options.embedding } : {}),
    dimensions: config.embeddingDimensions,
    embed: () =>
      withAiDiagnostics({ stage: "query_embedding" }, () =>
        providers.embeddings.embedQuery(query, {
          maxAttempts: options.maxEmbeddingAttempts ?? 1,
          beforeRequest: () => assertAnalyticsQueryAccess(currentUser),
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        }),
      ),
  });
  const embedding = embeddingResolution.embedding;
  options.signal?.throwIfAborted();
  // An authorization failure must never turn into a permissive lexical fallback.
  await assertAnalyticsQueryAccess(currentUser);
  const embeddingFailure = embeddingResolution.failure;

  const vectorLiteral = embedding ? `[${embedding.join(",")}]` : undefined;
  const vectorDistance = vectorLiteral
    ? (sql.join([
        chunks.embedding,
        sql.raw(" <=> "),
        sql.param(vectorLiteral),
        sql.raw("::vector"),
      ]) as SQL<number>)
    : undefined;
  const lexical = lexicalSearchSql(
    query,
    {
      title: sql`coalesce(${documents.title}, ${dailyBriefs.title})`,
      body: chunks.text,
      vector: chunks.tsv,
      rawVector: true,
    },
    "any",
  );
  const textScore = lexical.score;
  const textMatch = lexical.match;
  const trigramMatch = lexical.typoMatch;
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
    if (kind === "vector" && vectorDistance) {
      conditions.push(
        modelCondition,
        isNotNull(chunks.embedding),
        lt(vectorDistance, MAX_VECTOR_DISTANCE),
      );
    }
    if (kind === "text") conditions.push(textMatch);
    if (kind === "trigram") conditions.push(trigramMatch);
    const selected = builder.where(and(...conditions));
    if (kind === "vector") {
      return vectorDistance ? selected.orderBy(asc(vectorDistance)).limit(CANDIDATE_LIMIT) : null;
    }
    if (kind === "text")
      return selected.orderBy(desc(textScore), asc(chunks.id)).limit(CANDIDATE_LIMIT);
    return selected.orderBy(desc(textScore), asc(chunks.id)).limit(CANDIDATE_LIMIT);
  };

  const branchSpecs = [
    ["document_vector", "vector", "document"],
    ["document_full_text", "text", "document"],
    ["document_trigram", "trigram", "document"],
    ["brief_vector", "vector", "brief"],
    ["brief_full_text", "text", "brief"],
    ["brief_trigram", "trigram", "brief"],
  ] as const;
  const activeBranches = branchSpecs.filter(
    ([, kind, sourceKind]) =>
      (sourceKind !== "brief" || filters.includeBriefs === true) &&
      (kind !== "vector" || Boolean(vectorDistance)),
  );
  const semanticChunkIds = new Set<string>();
  const settled = await settleRetrievalBranches(
    activeBranches.map(([name, kind, sourceKind]) => ({
      name,
      run: async () => {
        const found = await queryCandidates(kind, sourceKind);
        if (kind === "vector")
          for (const source of found ?? []) semanticChunkIds.add(source.chunkId);
        return found;
      },
    })),
  );
  const successfulLists = settled.results.filter(
    (list): list is Exclude<typeof list, null> => list !== null,
  );
  options.signal?.throwIfAborted();
  const failedBranches = [...settled.failed];
  if (embeddingFailure) failedBranches.push(`embedding_${embeddingFailure}`);
  if (failedBranches.length) {
    console.warn("[analytics-search] branch failures", JSON.stringify(failedBranches));
  }

  const candidates = reciprocalRankFusion(successfulLists, 60)
    .filter(({ item }) => matchesNamedEntities(query, { title: item.title, body: item.text }))
    .slice(0, RERANK_CANDIDATE_LIMIT);
  if (candidates.length === 0) return [];

  const rerankProvider =
    options.rerankProvider ??
    (config.enableRerank && config.lightModel
      ? new GeminiRerankProvider(providers.light)
      : undefined);
  const candidateSources: AnalyticsSource[] = candidates.map(({ item }, index) => {
    const quote = item.text.replace(/\s+/g, " ").trim();
    const { id: _id, ...source } = item;
    return {
      ...source,
      n: index + 1,
      sourceKind: item.sourceKind as AnalyticsSource["sourceKind"],
      quote: quote.length > 360 ? quote.slice(0, 357) + "…" : quote,
      attachmentCount: 0,
      sourceReliability: item.sourceReliability as AnalyticsSource["sourceReliability"],
      infoCredibility: item.infoCredibility as AnalyticsSource["infoCredibility"],
    };
  });
  const access = await withAnalyticsSourceAccess(
    candidateSources,
    currentUser.id,
    (available, liveClearance) => {
      assertAnalyticsQuestionAccess(currentUser, liveClearance);
      return available;
    },
  );
  const accessibleCandidates = access.sources;
  options.signal?.throwIfAborted();
  const ids = await withAiDiagnostics({ stage: "rerank" }, () =>
    rerankOrderOrOriginal(
      query,
      accessibleCandidates.map((source) => ({
        id: source.chunkId,
        excerpt: source.text.slice(0, 500),
      })),
      rerankProvider,
      options.enableRerank ?? config.enableRerank,
      undefined,
      options.signal,
      async () => {
        await requireAnalyticsSourceAccess(accessibleCandidates, currentUser);
      },
    ),
  );
  // Include every excerpt sent to rerank, even if evidence selection omits it.
  options.signal?.throwIfAborted();
  await requireAnalyticsSourceAccess(accessibleCandidates, currentUser);
  const candidateById = new Map(accessibleCandidates.map((source) => [source.chunkId, source]));
  options.signal?.throwIfAborted();
  const ranked = ids
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is AnalyticsSource => candidate !== undefined);
  const fused = selectAnalyticsEvidence(query, ranked, semanticChunkIds);

  const documentIds = [
    ...new Set(fused.flatMap((item) => (item.documentId ? [item.documentId] : []))),
  ];
  const briefIds = [...new Set(fused.flatMap((item) => (item.briefId ? [item.briefId] : [])))];
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
          .where(and(inArray(briefAttachments.briefId, briefIds), briefAccessFilter()))
          .groupBy(briefAttachments.briefId)
      : Promise.resolve([]),
  ]);
  const countByDocument = new Map(documentCounts.map((row) => [row.id, Number(row.total)]));
  const countByBrief = new Map(briefCounts.map((row) => [row.id, Number(row.total)]));

  return fused.map((item, index) => {
    const sourceKind = item.sourceKind;
    return {
      ...item,
      n: index + 1,
      attachmentCount:
        sourceKind === "brief"
          ? item.briefId
            ? (countByBrief.get(item.briefId) ?? 0)
            : 0
          : item.documentId
            ? (countByDocument.get(item.documentId) ?? 0)
            : 0,
    };
  });
}
