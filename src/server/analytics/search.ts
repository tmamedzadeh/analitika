import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import type { AnalyticsFilters, AnalyticsSource } from "@/lib/analytics";
import { createGeminiProviders } from "@/server/ai/gemini";
import { getDb } from "@/server/db";
import { accessFilter } from "@/server/db/access";
import { attachments, chunks, documents } from "@/server/db/schema";
import { reciprocalRankFusion } from "./ranking";

const CANDIDATE_LIMIT = 50;
const RESULT_LIMIT = 10;
const MAX_VECTOR_DISTANCE = 0.4;
const RELIABILITY_GRADES = ["A", "B", "C", "D", "E", "F"] as const;

function minimumDocDate(period: AnalyticsFilters["period"]): string | null {
  if (period === "all") return null;
  const date = new Date();
  if (period === "30d") date.setUTCDate(date.getUTCDate() - 30);
  else date.setUTCMonth(date.getUTCMonth() - 12);
  return date.toISOString().slice(0, 10);
}

function documentConditions(filters: AnalyticsFilters) {
  const conditions = [eq(documents.status, "ready"), accessFilter()];
  const fromDate = minimumDocDate(filters.period);
  if (fromDate) conditions.push(gte(documents.docDate, fromDate));
  if (filters.tag) conditions.push(arrayContains(documents.tags, [filters.tag]));
  if (filters.documentId) conditions.push(eq(documents.id, filters.documentId));

  if (filters.minSourceReliability !== "all") {
    const index = RELIABILITY_GRADES.indexOf(filters.minSourceReliability);
    conditions.push(inArray(documents.sourceReliability, RELIABILITY_GRADES.slice(0, index + 1)));
  }
  if (filters.minInfoCredibility !== "all") {
    conditions.push(lte(documents.infoCredibility, Number(filters.minInfoCredibility)));
  }

  return conditions;
}

function sourceProjection() {
  return {
    id: chunks.id,
    chunkId: chunks.id,
    documentId: documents.id,
    title: documents.title,
    docDate: documents.docDate,
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
): Promise<AnalyticsSource[]> {
  const db = getDb();
  const embedding = await createGeminiProviders().embeddings.embedQuery(query);
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

  const [vectorRows, fullTextRows, trigramRows] = await Promise.all([
    db
      .select(sourceProjection())
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(
        and(...conditions, isNotNull(chunks.embedding), lt(vectorDistance, MAX_VECTOR_DISTANCE)),
      )
      .orderBy(asc(vectorDistance))
      .limit(CANDIDATE_LIMIT),
    db
      .select(sourceProjection())
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(and(...conditions, textMatch))
      .orderBy(desc(textScore))
      .limit(CANDIDATE_LIMIT),
    db
      .select(sourceProjection())
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(and(...conditions, trigramMatch))
      .orderBy(desc(similarity))
      .limit(CANDIDATE_LIMIT),
  ]);

  const fused = reciprocalRankFusion([vectorRows, fullTextRows, trigramRows], 60).slice(
    0,
    RESULT_LIMIT,
  );
  if (fused.length === 0) return [];

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
      sectionTitle: item.sectionTitle,
      text: item.text,
      quote: quote.length > 360 ? quote.slice(0, 357) + "…" : quote,
      charStart: item.charStart,
      charEnd: item.charEnd,
      isTable: item.isTable,
      attachmentCount: countByDocument.get(item.documentId) ?? 0,
      tags: item.tags,
      sourceReliability: item.sourceReliability,
      infoCredibility: item.infoCredibility,
    };
  });
}

export async function getAnalyticsOptions(): Promise<{
  tags: string[];
  documents: Array<{ id: string; title: string; docDate: string | null }>;
}> {
  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      docDate: documents.docDate,
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
    documents: rows.map(({ id, title, docDate }) => ({ id, title, docDate })),
  };
}
