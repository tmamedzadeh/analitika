import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { inArray, or, sql } from "drizzle-orm";
import postgres from "postgres";
import { z } from "zod";

import { formatBriefEmbeddingText } from "../src/lib/briefs";
import { OSINT_GEMINI_CALL_BUDGET, OSINT_LANGUAGES, OSINT_PERIODS } from "../src/lib/osint";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { getAppConfig } from "../src/server/config";
import { closeDb, getDb } from "../src/server/db";
import {
  attachments,
  briefAttachments,
  chunks,
  dailyBriefs,
  documentAcl,
  documents,
  infoRequests,
  osintCache,
  osintRuns,
  osintSources,
  queryLogs,
  requestAttachments,
} from "../src/server/db/schema";
import { chunkDocument } from "../src/server/ingest/chunker";
import { createOsintCacheKey } from "../src/server/osint/urls";
import { findPinnedOsintRun, shouldServePinnedCache } from "../src/server/osint/cache";
import { closeStorage, getStorage } from "../src/server/storage/s3";
import { readServerEnv, requireServerEnv } from "../src/server/env";

const dataFile = resolve(process.cwd(), "zirve_military_seed_data_2026-10-18.json");
const expectedCounts = { dailyBriefs: 10, documents: 10, osintRuns: 10, osintSources: 30 } as const;
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)));
const timestampSchema = z.string().datetime({ offset: true });
const datasetSchema = z.object({
  meta: z.object({
    recordCounts: z.object({
      dailyBriefs: z.number(),
      documents: z.number(),
      osintRuns: z.number(),
    }),
    osintSeedNotice: z.string().min(1),
  }),
  dailyBriefs: z.array(
    z.object({
      title: z.string().min(1),
      date: dateSchema,
      body: z.string().min(1).max(200_000),
      status: z.literal("published"),
      authorId: z.string().min(1),
      publishedAt: timestampSchema,
    }),
  ),
  documents: z.array(
    z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      docDate: dateSchema,
      department: z.enum(["d1", "d2", "d3", "d4", "d5"]),
      tags: z.array(z.string()),
      language: z.literal("az"),
      sourceReliability: z.enum(["A", "B", "C", "D", "E", "F"]),
      infoCredibility: z.number().int().min(1).max(6),
      ownerId: z.string().min(1),
    }),
  ),
  osintRuns: z.array(
    z.object({
      query: z.string().min(3),
      period: z.enum(OSINT_PERIODS),
      languages: z.array(z.enum(OSINT_LANGUAGES)).min(1),
      summary: z.string().min(1),
      status: z.literal("done"),
      step: z.literal("done"),
      pinned: z.literal(true),
      createdAt: timestampSchema,
      finishedAt: timestampSchema,
      sources: z.array(
        z.object({
          n: z.number().int().positive(),
          title: z.string().min(1),
          url: z.string().url(),
          domain: z.string().min(1),
          language: z.string().min(1),
          publishedAt: timestampSchema.nullable(),
          sourceType: z.enum(["media", "official", "think_tank", "other"]),
          summary: z.string(),
          snippet: z.string(),
          fetched: z.literal(false),
          fetchStatus: z.literal("snippet_fallback"),
        }),
      ),
    }),
  ),
});

type SeedDataset = z.infer<typeof datasetSchema>;
type DatabaseMetadata = {
  host: string;
  database: string;
  serverAddress: string | null;
  serverVersion: string;
  uniqueBriefDateRules: string[];
};
type ResetSnapshot = {
  briefIds: string[];
  documentIds: string[];
  osintRunIds: string[];
  sourceIds: string[];
  chunkIds: string[];
  briefChunkCount: number;
  documentChunkCount: number;
  briefAttachmentKeys: string[];
  attachmentKeys: string[];
  osintCacheKeys: string[];
  linkedInfoRequestCount: number;
  infoRequestCount: number;
  requestAttachmentCount: number;
  queryLogCount: number;
};
type SourceChunk = ReturnType<typeof chunkDocument>[number];

const fetchStatuses = [
  "provider_text",
  "fetched_full",
  "snippet_fallback",
  "robots_denied",
  "dns_or_network_error",
  "http_error",
  "non_html",
  "timeout",
  "invalid_url",
] as const;

function parseMode(): "dry-run" | "reset-and-seed" {
  const args = process.argv.slice(2);
  const supported = new Set(["--dry-run", "--reset-and-seed"]);
  const unknown = args.filter((arg) => !supported.has(arg));
  if (unknown.length) throw new Error(`Unsupported argument: ${unknown.join(", ")}`);
  if (args.includes("--dry-run") && args.includes("--reset-and-seed")) {
    throw new Error("Choose either --dry-run or --reset-and-seed.");
  }
  return args.includes("--reset-and-seed") ? "reset-and-seed" : "dry-run";
}

async function readDataset(): Promise<SeedDataset> {
  const json = JSON.parse(await readFile(dataFile, "utf8")) as unknown;
  const dataset = datasetSchema.parse(json);
  const sourceCount = dataset.osintRuns.reduce((total, run) => total + run.sources.length, 0);
  const dateCounts = new Map<string, number>();
  for (const brief of dataset.dailyBriefs) {
    dateCounts.set(brief.date, (dateCounts.get(brief.date) ?? 0) + 1);
  }
  if (
    dataset.meta.recordCounts.dailyBriefs !== expectedCounts.dailyBriefs ||
    dataset.meta.recordCounts.documents !== expectedCounts.documents ||
    dataset.meta.recordCounts.osintRuns !== expectedCounts.osintRuns ||
    dataset.dailyBriefs.length !== expectedCounts.dailyBriefs ||
    dataset.documents.length !== expectedCounts.documents ||
    dataset.osintRuns.length !== expectedCounts.osintRuns ||
    sourceCount !== expectedCounts.osintSources ||
    ![...dateCounts.values()].some((count) => count > 1)
  ) {
    throw new Error("The supplied seed JSON does not match the required 10/10/10/30 corpus.");
  }
  return dataset;
}

function connectionMetadata(connectionString: string): {
  host: string;
  database: string;
  project?: string;
} {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0] ?? "");
  const username = decodeURIComponent(url.username);
  const project = username.startsWith("postgres.") ? username.slice("postgres.".length) : undefined;
  return { host: url.hostname.toLowerCase(), database, ...(project ? { project } : {}) };
}

async function inspectDatabase(connectionString: string): Promise<DatabaseMetadata> {
  const target = connectionMetadata(connectionString);
  const client = postgres(connectionString, { max: 1, prepare: false });
  try {
    const [server] = await client<
      {
        database: string;
        serverAddress: string | null;
        serverVersion: string;
      }[]
    >`
      SELECT current_database() AS database,
        inet_server_addr()::text AS "serverAddress",
        current_setting('server_version') AS "serverVersion"
    `;
    const uniqueDateRows = await client<{ name: string }[]>`
      SELECT c.conname AS name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'brief_date'
      WHERE t.relname = 'daily_briefs'
        AND c.contype = 'u'
        AND c.conkey = ARRAY[a.attnum]::smallint[]
      UNION ALL
      SELECT i.indexrelid::regclass::text AS name
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'brief_date'
      WHERE t.relname = 'daily_briefs'
        AND i.indisunique
        AND i.indnatts = 1
        AND i.indkey[0] = a.attnum
    `;
    if (!server || server.database !== target.database) {
      throw new Error("Database metadata did not match the configured database name.");
    }
    return {
      ...target,
      serverAddress: server.serverAddress,
      serverVersion: server.serverVersion,
      uniqueBriefDateRules: [...new Set(uniqueDateRows.map((row) => row.name))],
    };
  } finally {
    await client.end();
  }
}

function demoTargetGate(metadata: DatabaseMetadata): { allowed: boolean; reason: string } {
  const env = readServerEnv();
  const production =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const migrationUrl = process.env.DATABASE_URL_MIGRATE?.trim();
  const appUrl = requireServerEnv("DATABASE_URL");
  const appTarget = connectionMetadata(appUrl);
  const migrationTarget = migrationUrl ? connectionMetadata(migrationUrl) : null;
  const sameDatabase = Boolean(
    migrationTarget &&
    appTarget.database === migrationTarget.database &&
    (!appTarget.project ||
      !migrationTarget.project ||
      appTarget.project === migrationTarget.project),
  );
  const knownProvider =
    metadata.host.endsWith(".pooler.supabase.com") ||
    metadata.host === "localhost" ||
    metadata.host === "127.0.0.1";
  const allowed = Boolean(env.DEMO_BASIC_AUTH) && !production && sameDatabase && knownProvider;
  if (allowed) {
    return {
      allowed,
      reason:
        "local non-production configuration has demo auth and matching app/migration database targets",
    };
  }
  return {
    allowed,
    reason:
      "could not confirm a local dev/demo target from demo auth, non-production mode, and matching app/migration database metadata",
  };
}

async function countRows(table: typeof infoRequests): Promise<number>;
async function countRows(table: typeof requestAttachments): Promise<number>;
async function countRows(table: typeof queryLogs): Promise<number>;
async function countRows(
  table: typeof infoRequests | typeof requestAttachments | typeof queryLogs,
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(table);
  return Number(row?.count ?? 0);
}

async function loadSnapshot(): Promise<ResetSnapshot> {
  const db = getDb();
  const [briefRows, documentRows, runRows, sourceRows] = await Promise.all([
    db.select({ id: dailyBriefs.id }).from(dailyBriefs),
    db.select({ id: documents.id }).from(documents),
    db.select({ id: osintRuns.id }).from(osintRuns),
    db.select({ id: osintSources.id }).from(osintSources),
  ]);
  const briefIds = briefRows.map((row) => row.id);
  const documentIds = documentRows.map((row) => row.id);
  const osintRunIds = runRows.map((row) => row.id);
  const [briefFileRows, attachmentRows, chunkRows, cacheRows, linkedRequests] = await Promise.all([
    briefIds.length
      ? db
          .select({ storageKey: briefAttachments.storageKey })
          .from(briefAttachments)
          .where(inArray(briefAttachments.briefId, briefIds))
      : Promise.resolve([]),
    documentIds.length
      ? db
          .select({ storageKey: attachments.storageKey })
          .from(attachments)
          .where(inArray(attachments.documentId, documentIds))
      : Promise.resolve([]),
    briefIds.length || documentIds.length
      ? db
          .select({ id: chunks.id, documentId: chunks.documentId, briefId: chunks.briefId })
          .from(chunks)
          .where(
            or(
              ...(documentIds.length ? [inArray(chunks.documentId, documentIds)] : []),
              ...(briefIds.length ? [inArray(chunks.briefId, briefIds)] : []),
            ),
          )
      : Promise.resolve([]),
    osintRunIds.length
      ? db
          .select({ cacheKey: osintCache.cacheKey })
          .from(osintCache)
          .where(inArray(osintCache.runId, osintRunIds))
      : Promise.resolve([]),
    documentIds.length
      ? db
          .select({ id: infoRequests.id })
          .from(infoRequests)
          .where(inArray(infoRequests.answerDocumentId, documentIds))
      : Promise.resolve([]),
  ]);
  const [infoRequestCount, requestAttachmentCount, queryLogCount] = await Promise.all([
    countRows(infoRequests),
    countRows(requestAttachments),
    countRows(queryLogs),
  ]);
  return {
    briefIds,
    documentIds,
    osintRunIds,
    sourceIds: sourceRows.map((row) => row.id),
    chunkIds: chunkRows.map((row) => row.id),
    briefChunkCount: chunkRows.filter((row) => row.briefId !== null).length,
    documentChunkCount: chunkRows.filter((row) => row.documentId !== null).length,
    briefAttachmentKeys: briefFileRows.map((row) => row.storageKey),
    attachmentKeys: attachmentRows.map((row) => row.storageKey),
    osintCacheKeys: cacheRows.map((row) => row.cacheKey),
    linkedInfoRequestCount: linkedRequests.length,
    infoRequestCount,
    requestAttachmentCount,
    queryLogCount,
  };
}

function uniqueStorageKeys(snapshot: ResetSnapshot): string[] {
  return [...new Set([...snapshot.briefAttachmentKeys, ...snapshot.attachmentKeys])];
}

function printCounts(label: string, snapshot: ResetSnapshot): void {
  const storageCount = uniqueStorageKeys(snapshot).length;
  console.log(`${label}:`);
  console.log(
    `  daily_briefs=${snapshot.briefIds.length}; brief chunks=${snapshot.briefChunkCount}; brief_attachments=${snapshot.briefAttachmentKeys.length}`,
  );
  console.log(
    `  documents=${snapshot.documentIds.length}; document chunks=${snapshot.documentChunkCount}; attachments=${snapshot.attachmentKeys.length}`,
  );
  console.log(
    `  osint_runs=${snapshot.osintRunIds.length}; osint_sources=${snapshot.sourceIds.length}; osint_cache=${snapshot.osintCacheKeys.length}`,
  );
  console.log(`  exact Storage objects identified=${storageCount}`);
  console.log(
    `  info_requests=${snapshot.infoRequestCount}; request_attachments=${snapshot.requestAttachmentCount}; query_logs=${snapshot.queryLogCount} (all retained)`,
  );
  if (snapshot.linkedInfoRequestCount) {
    console.log(
      `  documents linked to info_requests=${snapshot.linkedInfoRequestCount} (reset must stop to preserve those requests)`,
    );
  }
}

function buildEmbeddingSources(dataset: SeedDataset) {
  const documentsToIndex = dataset.documents.map((document) => ({
    id: randomUUID(),
    document,
    sourceChunks: chunkDocument(document.body, document.title),
  }));
  const briefsToIndex = dataset.dailyBriefs.map((brief) => ({
    id: randomUUID(),
    brief,
    sourceChunks: chunkDocument(brief.body, brief.title),
  }));
  const sources: Array<{
    sourceId: string;
    briefId: string | null;
    chunk: SourceChunk;
    text: string;
  }> = [
    ...documentsToIndex.flatMap(({ id, document, sourceChunks }) =>
      sourceChunks.map((chunk) => ({
        sourceId: id,
        briefId: null,
        chunk,
        text: chunk.embeddingText,
      })),
    ),
    ...briefsToIndex.flatMap(({ id, brief, sourceChunks }) =>
      sourceChunks.map((chunk) => ({
        sourceId: id,
        briefId: id,
        chunk,
        text: formatBriefEmbeddingText(brief.title, brief.date, chunk.text),
      })),
    ),
  ];
  if (
    documentsToIndex.some(({ sourceChunks }) => sourceChunks.length === 0) ||
    briefsToIndex.some(({ sourceChunks }) => sourceChunks.length === 0)
  ) {
    throw new Error("The seed corpus contains a document or brief with no indexable text chunks.");
  }
  return { documentsToIndex, briefsToIndex, sources };
}

function makeOsintProgress(languageCount: number, sourceCount: number, notice: string) {
  const fetchStatusCounts = Object.fromEntries(fetchStatuses.map((status) => [status, 0]));
  fetchStatusCounts["snippet_fallback"] = sourceCount;
  return {
    percent: 100,
    completedLanguages: languageCount,
    totalLanguages: languageCount,
    sourcesFound: sourceCount,
    sourcesProcessed: sourceCount,
    providerCalls: 0,
    providerCallBudget: OSINT_GEMINI_CALL_BUDGET,
    searchCalls: 0,
    llmCalls: 0,
    llmCallBudget: OSINT_GEMINI_CALL_BUDGET,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmUsageReportedCalls: 0,
    fetchStatusCounts,
    failedSteps: [],
    notice,
  };
}

async function embedCorpus(dataset: SeedDataset) {
  const prepared = buildEmbeddingSources(dataset);
  const provider = createGeminiProviders().embeddings;
  const configuredModel = getAppConfig().embeddingModel;
  if (provider.model !== configuredModel) {
    throw new Error("Active embedding provider model does not match GEMINI_EMBED_MODEL.");
  }
  let vectors: number[][];
  try {
    vectors = await provider.embedDocuments(
      prepared.sources.map((source) => source.text),
      { maxAttempts: 1 },
    );
  } catch (error) {
    throw new Error(
      `Embedding generation failed before reset; existing data and Storage were left untouched. ${String(error)}`,
    );
  }
  if (
    vectors.length !== prepared.sources.length ||
    vectors.some(
      (vector) => vector.length !== 768 || vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error(
      "The embedding provider did not return one 768-dimensional finite vector per chunk.",
    );
  }
  return { ...prepared, vectors, embeddingModel: provider.model };
}

function briefIndexProgress(totalChunks: number) {
  return { percent: 100, totalChunks, completedChunks: totalChunks };
}

async function resetAndInsert(
  dataset: SeedDataset,
  snapshot: ResetSnapshot,
  embedded: Awaited<ReturnType<typeof embedCorpus>>,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const config = getAppConfig();
  const providerIdentity = `${config.searchProvider}:${config.analyticsModel}:${config.lightModel}`;
  const preparedRuns = dataset.osintRuns.map((run) => {
    const cacheKey = createOsintCacheKey(
      run.query,
      [...run.languages],
      run.period,
      providerIdentity,
    );
    return { id: randomUUID(), run, cacheKey, pinned: true };
  });
  const preparedSources = preparedRuns.flatMap(({ id, run }) =>
    run.sources.map((source) => ({ id: randomUUID(), runId: id, source })),
  );
  const chunksToInsert = embedded.sources.map((source, index) => ({
    documentId: source.briefId ? null : source.sourceId,
    briefId: source.briefId,
    ord: source.chunk.ord,
    sectionTitle: source.chunk.sectionTitle,
    text: source.chunk.text,
    charStart: source.chunk.charStart,
    charEnd: source.chunk.charEnd,
    isTable: source.chunk.isTable,
    embedding: embedded.vectors[index]!,
    embeddingModel: embedded.embeddingModel,
  }));

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      LOCK TABLE daily_briefs, documents, document_acl, chunks, brief_attachments,
        attachments, osint_runs, osint_sources, osint_cache, info_requests
      IN SHARE ROW EXCLUSIVE MODE
    `);
    const currentBriefs = await transaction.select({ id: dailyBriefs.id }).from(dailyBriefs);
    const currentDocuments = await transaction.select({ id: documents.id }).from(documents);
    const currentRuns = await transaction.select({ id: osintRuns.id }).from(osintRuns);
    const idsMatch = (current: { id: string }[], expected: string[]) =>
      current.length === expected.length && current.every((row) => expected.includes(row.id));
    if (
      !idsMatch(currentBriefs, snapshot.briefIds) ||
      !idsMatch(currentDocuments, snapshot.documentIds) ||
      !idsMatch(currentRuns, snapshot.osintRunIds)
    ) {
      throw new Error(
        "Target section records changed after the read-only preflight; no database rows were replaced.",
      );
    }
    if (snapshot.documentIds.length) {
      const linkedRequests = await transaction
        .select({ id: infoRequests.id })
        .from(infoRequests)
        .where(inArray(infoRequests.answerDocumentId, snapshot.documentIds));
      if (linkedRequests.length) {
        throw new Error("Reset stopped because a document is linked to an info_request.");
      }
    }

    if (snapshot.documentIds.length || snapshot.briefIds.length) {
      await transaction
        .delete(chunks)
        .where(
          or(
            ...(snapshot.documentIds.length
              ? [inArray(chunks.documentId, snapshot.documentIds)]
              : []),
            ...(snapshot.briefIds.length ? [inArray(chunks.briefId, snapshot.briefIds)] : []),
          ),
        );
    }
    if (snapshot.briefIds.length) {
      await transaction
        .delete(briefAttachments)
        .where(inArray(briefAttachments.briefId, snapshot.briefIds));
    }
    if (snapshot.documentIds.length) {
      await transaction
        .delete(attachments)
        .where(inArray(attachments.documentId, snapshot.documentIds));
      await transaction
        .delete(documentAcl)
        .where(inArray(documentAcl.documentId, snapshot.documentIds));
    }
    if (snapshot.osintRunIds.length) {
      await transaction.delete(osintCache).where(inArray(osintCache.runId, snapshot.osintRunIds));
      await transaction
        .delete(osintSources)
        .where(inArray(osintSources.runId, snapshot.osintRunIds));
    }
    if (snapshot.osintRunIds.length)
      await transaction.delete(osintRuns).where(inArray(osintRuns.id, snapshot.osintRunIds));
    if (snapshot.documentIds.length)
      await transaction.delete(documents).where(inArray(documents.id, snapshot.documentIds));
    if (snapshot.briefIds.length)
      await transaction.delete(dailyBriefs).where(inArray(dailyBriefs.id, snapshot.briefIds));

    await transaction.insert(documents).values(
      embedded.documentsToIndex.map(({ id, document, sourceChunks }) => ({
        id,
        title: document.title,
        body: document.body,
        department: document.department,
        docDate: document.docDate,
        tags: document.tags,
        language: document.language,
        classification: "open",
        sourceReliability: document.sourceReliability,
        infoCredibility: document.infoCredibility,
        ownerId: document.ownerId,
        status: "ready" as const,
        step: "ready",
        progress: {
          percent: 100,
          totalChunks: sourceChunks.length,
          completedChunks: sourceChunks.length,
        },
        error: null,
        updatedAt: now,
      })),
    );
    await transaction.insert(dailyBriefs).values(
      embedded.briefsToIndex.map(({ id, brief, sourceChunks }) => ({
        id,
        briefDate: brief.date,
        title: brief.title,
        body: brief.body,
        status: "published",
        authorId: brief.authorId,
        indexStatus: "ready",
        indexProgress: briefIndexProgress(sourceChunks.length),
        publishedAt: new Date(brief.publishedAt),
        updatedAt: now,
      })),
    );
    await transaction.insert(osintRuns).values(
      preparedRuns.map(({ id, run, cacheKey, pinned }) => ({
        id,
        query: run.query,
        languages: run.languages,
        period: run.period,
        status: "done" as const,
        step: "done",
        progress: makeOsintProgress(
          run.languages.length,
          run.sources.length,
          dataset.meta.osintSeedNotice,
        ),
        summary: run.summary,
        error: null,
        cacheKey,
        pinned,
        createdAt: new Date(run.createdAt),
        finishedAt: new Date(run.finishedAt),
      })),
    );
    if (preparedSources.length) {
      await transaction.insert(osintSources).values(
        preparedSources.map(({ id, runId, source }) => ({
          id,
          runId,
          n: source.n,
          title: source.title,
          url: source.url,
          domain: source.domain,
          language: source.language,
          publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
          sourceType: source.sourceType,
          summary: source.summary,
          snippet: source.snippet,
          fetched: false,
          fetchStatus: "snippet_fallback",
        })),
      );
    }
    if (chunksToInsert.length) await transaction.insert(chunks).values(chunksToInsert);
  });
}

async function deleteExactStorageObjects(snapshot: ResetSnapshot): Promise<{
  succeeded: number;
  failed: Array<{ key: string; reason: string }>;
}> {
  const keys = uniqueStorageKeys(snapshot);
  if (!keys.length) return { succeeded: 0, failed: [] };
  const storage = getStorage();
  let succeeded = 0;
  const failed: Array<{ key: string; reason: string }> = [];
  for (const key of keys) {
    try {
      await storage.delete(key);
      succeeded += 1;
    } catch (error) {
      failed.push({ key, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { succeeded, failed };
}

async function printFinalVerification(
  dataset: SeedDataset,
  embedded: Awaited<ReturnType<typeof embedCorpus>>,
  before: ResetSnapshot,
): Promise<void> {
  const db = getDb();
  const [
    briefRows,
    documentRows,
    runRows,
    sourceRows,
    briefRequestCount,
    requestAttachmentCount,
    queryLogCount,
  ] = await Promise.all([
    db
      .select({
        id: dailyBriefs.id,
        date: dailyBriefs.briefDate,
        title: dailyBriefs.title,
        body: dailyBriefs.body,
        status: dailyBriefs.status,
        indexStatus: dailyBriefs.indexStatus,
      })
      .from(dailyBriefs),
    db
      .select({
        id: documents.id,
        title: documents.title,
        body: documents.body,
        status: documents.status,
        step: documents.step,
      })
      .from(documents),
    db
      .select({
        id: osintRuns.id,
        query: osintRuns.query,
        status: osintRuns.status,
        step: osintRuns.step,
        pinned: osintRuns.pinned,
        cacheKey: osintRuns.cacheKey,
      })
      .from(osintRuns),
    db
      .select({
        runId: osintSources.runId,
        title: osintSources.title,
        url: osintSources.url,
        fetched: osintSources.fetched,
        fetchStatus: osintSources.fetchStatus,
      })
      .from(osintSources),
    countRows(infoRequests),
    countRows(requestAttachments),
    countRows(queryLogs),
  ]);
  const briefIds = briefRows.map((row) => row.id);
  const documentIds = documentRows.map((row) => row.id);
  const runIds = runRows.map((row) => row.id);
  const config = getAppConfig();
  const providerIdentity = `${config.searchProvider}:${config.analyticsModel}:${config.lightModel}`;
  const pinnedLookups = await Promise.all(
    dataset.osintRuns.map((run) =>
      findPinnedOsintRun(
        createOsintCacheKey(run.query, [...run.languages], run.period, providerIdentity),
      ),
    ),
  );
  const pinnedCacheHits = pinnedLookups.filter(
    (run) =>
      run &&
      shouldServePinnedCache({ pinned: run.pinned, done: run.status === "done", refresh: false }),
  ).length;
  const seededChunks = await db
    .select({
      documentId: chunks.documentId,
      briefId: chunks.briefId,
      embedding: chunks.embedding,
      embeddingModel: chunks.embeddingModel,
    })
    .from(chunks)
    .where(
      or(
        ...(documentIds.length ? [inArray(chunks.documentId, documentIds)] : []),
        ...(briefIds.length ? [inArray(chunks.briefId, briefIds)] : []),
      ),
    );
  const groupedBriefs = new Map<string, number>();
  for (const brief of briefRows)
    groupedBriefs.set(brief.date, (groupedBriefs.get(brief.date) ?? 0) + 1);
  const duplicateBriefDates = [...groupedBriefs.values()].filter((count) => count > 1).length;
  const allReady =
    briefRows.length === expectedCounts.dailyBriefs &&
    briefRows.every((row) => row.status === "published" && row.indexStatus === "ready") &&
    documentRows.length === expectedCounts.documents &&
    documentRows.every((row) => row.status === "ready" && row.step === "ready") &&
    runRows.length === expectedCounts.osintRuns &&
    runRows.every(
      (row) => row.status === "done" && row.step === "done" && row.pinned && Boolean(row.cacheKey),
    ) &&
    sourceRows.length === expectedCounts.osintSources &&
    sourceRows.every((source) => !source.fetched && source.fetchStatus === "snippet_fallback") &&
    pinnedCacheHits === expectedCounts.osintRuns &&
    duplicateBriefDates > 0 &&
    briefRequestCount === before.infoRequestCount &&
    requestAttachmentCount === before.requestAttachmentCount &&
    queryLogCount === before.queryLogCount;
  const embeddingsValid =
    seededChunks.length === embedded.sources.length &&
    seededChunks.every(
      (chunk) =>
        chunk.embedding?.length === 768 &&
        chunk.embedding.every((value) => Number.isFinite(value)) &&
        chunk.embeddingModel === embedded.embeddingModel,
    );
  console.log("Final database read-back:");
  console.log(
    `  daily_briefs=${briefRows.length}; duplicate-date groups=${duplicateBriefDates}; published/indexed=${briefRows.filter((row) => row.status === "published" && row.indexStatus === "ready").length}`,
  );
  console.log(
    `  documents=${documentRows.length}; ready=${documentRows.filter((row) => row.status === "ready" && row.step === "ready").length}`,
  );
  console.log(
    `  osint_runs=${runRows.length}; done+pinned=${runRows.filter((row) => row.status === "done" && row.pinned && Boolean(row.cacheKey)).length}; osint_sources=${sourceRows.length}`,
  );
  console.log(
    `  chunks=${seededChunks.length}; expected=${embedded.sources.length}; 768-dimensional finite embeddings with active model=${embeddingsValid ? "yes" : "no"}`,
  );
  console.log(
    `  info_requests=${briefRequestCount}; request_attachments=${requestAttachmentCount}; query_logs=${queryLogCount} (unchanged and retained)`,
  );
  console.log(
    `  pinned OSINT cache keys use current provider/models; seed runs=${dataset.osintRuns.length}`,
  );
  console.log(
    `  existing pinned-cache lookup serves exact seeded query/config matches=${pinnedCacheHits}/${expectedCounts.osintRuns}`,
  );
  const sampleBrief = briefRows[0];
  const sampleDocument = documentRows[0];
  const sampleRun = runRows[0];
  const sampleSource = sourceRows[0];
  console.log(
    `  read-back samples: brief=${sampleBrief?.title ?? "missing"} (${sampleBrief?.body.length ?? 0} chars); document=${sampleDocument?.title ?? "missing"} (${sampleDocument?.body.length ?? 0} chars); OSINT=${sampleRun?.query ?? "missing"}; source=${sampleSource?.title ?? "missing"} ${sampleSource?.url ?? ""}`,
  );
  if (!allReady || !embeddingsValid)
    throw new Error("Read-back verification failed; see actual counts above.");
}

function redact(message: string): string {
  const values = [
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_MIGRATE,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.EXA_API_KEY,
    process.env.S3_ACCESS_KEY_ID,
    process.env.S3_SECRET_ACCESS_KEY,
  ].filter((value): value is string => Boolean(value));
  let safe = message;
  for (const value of values) safe = safe.replaceAll(value, "[redacted]");
  return safe.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[redacted connection string]");
}

async function main(): Promise<void> {
  const mode = parseMode();
  const dataset = await readDataset();
  const databaseUrl = requireServerEnv("DATABASE_URL");
  const metadata = await inspectDatabase(databaseUrl);
  const before = await loadSnapshot();
  const gate = demoTargetGate(metadata);

  console.log(`Mode: ${mode}`);
  console.log(
    `Target database: host=${metadata.host}; database=${metadata.database}; server=${metadata.serverAddress ?? "not reported by provider"}; PostgreSQL=${metadata.serverVersion.split(" ")[0]}`,
  );
  console.log(`Dev/demo target guard: ${gate.allowed ? "passed" : "blocked"} (${gate.reason}).`);
  console.log(
    `Unique brief-date rules: ${metadata.uniqueBriefDateRules.length ? metadata.uniqueBriefDateRules.join(", ") : "none"}`,
  );
  printCounts("Counts before cleanup", before);
  console.log(`Seed input: ${dataFile}`);
  console.log(
    `Seed target: ${expectedCounts.dailyBriefs} briefs; ${expectedCounts.documents} documents; ${expectedCounts.osintRuns} OSINT runs; ${expectedCounts.osintSources} OSINT sources.`,
  );
  console.log(
    "Planned DB changes: replace only daily_briefs/documents and their own chunks/attachments, plus osint_runs/osint_sources/osint_cache; retain info_requests, request_attachments, query_logs, eval tables, and all unrelated records.",
  );
  if (mode === "dry-run") {
    console.log(
      "Dry run complete. No Storage objects were deleted, no rows were changed, and no AI provider was called.",
    );
    if (!gate.allowed)
      console.log("A real reset will stop until the target can be identified as dev/demo.");
    if (before.linkedInfoRequestCount)
      console.log("A real reset will stop because some documents are used by info_requests.");
    return;
  }

  if (!gate.allowed)
    throw new Error(`Reset blocked: ${gate.reason}. No data or Storage changes were made.`);
  if (before.linkedInfoRequestCount) {
    throw new Error(
      `Reset blocked: ${before.linkedInfoRequestCount} document(s) are linked to info_requests, which must be preserved.`,
    );
  }
  if (metadata.uniqueBriefDateRules.length) {
    throw new Error(
      "Reset blocked: run the new brief-date migration first; a unique rule still exists.",
    );
  }
  if (!process.env.DATABASE_URL_MIGRATE?.trim()) {
    throw new Error(
      "Reset blocked: DATABASE_URL_MIGRATE is required to confirm the migration target.",
    );
  }
  const migrationTarget = connectionMetadata(process.env.DATABASE_URL_MIGRATE);
  const appTarget = connectionMetadata(databaseUrl);
  if (
    migrationTarget.database !== appTarget.database ||
    (migrationTarget.project && appTarget.project && migrationTarget.project !== appTarget.project)
  ) {
    throw new Error(
      "Reset blocked: application and migration URLs do not identify the same database project.",
    );
  }

  console.log(
    "Generating embeddings for the supplied documents and published briefs before cleanup...",
  );
  const embedded = await embedCorpus(dataset);
  console.log(
    `Embedding generation complete: ${embedded.sources.length} vectors from ${embedded.embeddingModel}.`,
  );

  const storageResult = await deleteExactStorageObjects(before);
  console.log(
    `Storage cleanup: deleted ${storageResult.succeeded}/${uniqueStorageKeys(before).length} exact objects; ${storageResult.failed.length} failed.`,
  );
  for (const failure of storageResult.failed) {
    console.error(`  Storage object not deleted (${failure.key}): ${redact(failure.reason)}`);
  }

  try {
    await resetAndInsert(dataset, before, embedded);
  } catch (error) {
    if (storageResult.succeeded) {
      console.error(
        `Database transaction rolled back after ${storageResult.succeeded} Storage object(s) were already deleted; existing attachment rows may point to missing files.`,
      );
    }
    throw error;
  }
  await printFinalVerification(dataset, embedded, before);
  const after = await loadSnapshot();
  printCounts("Counts after seed", after);
  console.log(`Storage deletion errors: ${storageResult.failed.length}.`);
  console.log("Seed completed from the provided JSON; OSINT jobs were not launched.");
}

try {
  await main();
} catch (error) {
  const failure = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
  const message =
    typeof failure.message === "string" && failure.message ? failure.message : "(no error message)";
  const code = failure.code ? `; code=${String(failure.code)}` : "";
  const stack =
    typeof failure.stack === "string"
      ? `\n${failure.stack.split("\n").slice(1, 4).join("\n")}`
      : "";
  console.error(
    `Seed operation failed (${String(failure.name ?? "Error")}${code}): ${redact(message)}${redact(stack)}`,
  );
  process.exitCode = 1;
} finally {
  closeStorage();
  await closeDb();
}
