/** Same-project DB, scoped committed fixtures, injected vectors/local reranker; no external AI. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import { appUsers, chunks, dailyBriefs, documents } from "../src/server/db/schema";
import { withCurrentUser, type SessionUser } from "../src/server/auth";
import { searchDocumentChunks } from "../src/server/analytics/search";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";
import { directionIds } from "../src/lib/directions";
import type { AnalyticsFilters } from "../src/lib/analytics";
import { getBakuDate } from "../src/lib/briefs";

requireProjectEvaluationDatabase();
const db = getDb();
const user: SessionUser = {
  id: crypto.randomUUID(),
  username: `retrieval_${crypto.randomUUID()}`,
  role: "admin",
  clearance: "open",
  sessionId: "scoped-evaluation",
};
const token = `rcret${crypto.randomUUID().replaceAll("-", "")}`;
const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
const briefs = Array.from({ length: 2 }, () => crypto.randomUUID());
const today = getBakuDate();
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const filters: AnalyticsFilters = {
  period: "all",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};
const checks: string[] = [];
let stage = "setup";
let normalHnsw = false,
  forcedHnsw = false;
let externalCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  if (
    new URL(input instanceof Request ? input.url : String(input)).hostname ===
    "generativelanguage.googleapis.com"
  ) {
    externalCalls++;
    throw new Error("External AI disabled for scoped retrieval gate");
  }
  return realFetch(input, init);
}) as typeof fetch;
try {
  await db.insert(appUsers).values({
    id: user.id,
    username: user.username,
    passwordHash: "unusable-synthetic-fixture",
    role: user.role,
    clearance: user.clearance,
  });
  await db.insert(documents).values(
    ids.map((id, index) => ({
      id,
      ownerId: user.id,
      title: `${token} synthetic ${index}`,
      body: `${token} synthetic retrieval evidence ${index}`,
      status: "ready" as const,
      chunkCount: 1,
      step: "ready",
      direction: index === 2 ? "SIGINT" : "OSINT",
      classification: index === 1 ? "secret" : "open",
      docDate: index === 3 ? "2000-01-01" : index === 4 ? "2099-01-01" : today,
      sourceReliability: index === 5 ? "E" : "A",
      infoCredibility: index === 5 ? 5 : 1,
    })),
  );
  await db.insert(dailyBriefs).values(
    briefs.map((id, index) => ({
      id,
      authorId: user.id,
      title: `${token} synthetic brief`,
      body: `${token} synthetic brief evidence`,
      status: "published",
      briefDate: today,
      indexStatus: index === 0 ? "ready" : "none",
    })),
  );
  await db.insert(chunks).values([
    ...ids.map((id, index) => {
      const text = `${token} synthetic retrieval evidence ${index}`;
      return {
        documentId: id,
        ord: 0,
        text,
        charStart: 0,
        charEnd: text.length,
        embedding: vector,
        embeddingModel: index === 6 ? "synthetic-legacy-model" : "gemini-embedding-2",
      };
    }),
    ...briefs.map((id) => {
      const text = `${token} synthetic brief evidence`;
      return {
        briefId: id,
        ord: 0,
        text,
        charStart: 0,
        charEnd: text.length,
        embedding: vector,
        embeddingModel: "gemini-embedding-2",
      };
    }),
  ]);
  await withCurrentUser(user, async () => {
    const query = (queryFilters = filters, embedding = vector, text = token) =>
      searchDocumentChunks(text, queryFilters, { embedding, enableRerank: false });
    stage = "access";
    const all = await query();
    const sourceIds = new Set(all.map((s) => s.documentId ?? s.briefId));
    assert.ok(sourceIds.has(ids[0]!));
    assert.ok(sourceIds.has(briefs[0]!));
    assert.ok(!sourceIds.has(ids[1]!));
    assert.ok(!sourceIds.has(ids[4]!));
    assert.ok(!sourceIds.has(briefs[1]!));
    checks.push(
      "Owner/admin open clearance excludes secret content; future documents and unindexed briefs excluded",
    );
    stage = "filters";
    const directional = await query({ ...filters, directionIds: ["OSINT"] });
    assert.ok(directional.some((s) => s.documentId === ids[0]));
    assert.ok(!directional.some((s) => s.documentId === ids[2] || s.sourceKind === "brief"));
    const recent = await query({ ...filters, period: "30d" });
    assert.ok(!recent.some((s) => s.documentId === ids[3]));
    const reliable = await query({
      ...filters,
      minSourceReliability: "A",
      minInfoCredibility: "1",
    });
    assert.ok(!reliable.some((s) => s.documentId === ids[5] || s.sourceKind === "brief"));
    checks.push(
      "Real retrieval direction/period/reliability filters and document-only brief exclusion",
    );
    stage = "fallback";
    const lexical = await query(filters, [1]);
    assert.ok(lexical.some((s) => s.documentId === ids[0]));
    assert.ok(!lexical.some((s) => s.documentId === ids[1]));
    const unrelated = await query(
      filters,
      vector,
      `zzunmatched${crypto.randomUUID().replaceAll("-", "")}`,
    );
    assert.ok(!unrelated.some((s) => s.documentId === ids[6]));
    const noAnswer = await query(
      filters,
      [1],
      `zzunmatched${crypto.randomUUID().replaceAll("-", "")}`,
    );
    assert.equal(noAnswer.length, 0);
    checks.push(
      "Malformed query vector safely falls back to lexical; wrong model excluded from vector branch; lexical no-match evaluated separately",
    );
    stage = "query-policy-rerank";
    await db.update(appUsers).set({ clearance: "secret" }).where(eq(appUsers.id, user.id));
    let rerankCalls = 0;
    const restricted = await searchDocumentChunks(token, filters, {
      embedding: vector,
      enableRerank: true,
      rerankProvider: {
        rerank: async (_q, candidates) => {
          rerankCalls++;
          return candidates.map((c) => c.id);
        },
      },
    });
    assert.ok(restricted.some((s) => s.documentId === ids[1]));
    assert.equal(rerankCalls, 0);
    checks.push(
      "Higher-clearance local retrieval remains available; query classification prevents external rerank dispatch",
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      searchDocumentChunks(token, filters, { embedding: vector, signal: controller.signal }),
    );
    checks.push("Already-aborted retrieval rejects before DB/provider work");
  });
  stage = "HNSW";
  await db.transaction(async (tx) => {
    const query = sql`select id from chunks where embedding_model = 'gemini-embedding-2' and embedding is not null order by embedding <=> ${JSON.stringify(vector)}::vector limit 10`;
    normalHnsw = JSON.stringify(await tx.execute(sql`EXPLAIN (FORMAT JSON) ${query}`)).includes(
      "chunks_embedding_hnsw_idx",
    );
    await tx.execute(sql`set local enable_seqscan = off`);
    forcedHnsw = JSON.stringify(await tx.execute(sql`EXPLAIN (FORMAT JSON) ${query}`)).includes(
      "chunks_embedding_hnsw_idx",
    );
    assert.ok(forcedHnsw);
  });
  checks.push(
    "Configured 768-dimensional cosine HNSW index usable by matching model/order operator; normal and forced plans inspected",
  );
  assert.equal(externalCalls, 0);
} catch (error) {
  process.exitCode = 1;
  console.error(
    JSON.stringify({
      status: "FAIL",
      stage,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
} finally {
  globalThis.fetch = realFetch;
  await db.delete(documents).where(and(eq(documents.ownerId, user.id), inArray(documents.id, ids)));
  await db
    .delete(dailyBriefs)
    .where(and(eq(dailyBriefs.authorId, user.id), inArray(dailyBriefs.id, briefs)));
  await db.delete(appUsers).where(eq(appUsers.id, user.id));
  const leftover = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(or(inArray(chunks.documentId, ids), inArray(chunks.briefId, briefs)));
  assert.equal(leftover.length, 0);
  const result = {
    checkedAt: new Date().toISOString(),
    status: process.exitCode ? "FAIL" : "PASS",
    failureCase: process.exitCode ? stage : null,
    checks,
    normalHnsw,
    forcedHnsw,
    externalCalls,
    fixtureLeftovers: leftover.length,
    baseline:
      "Existing 17-query real-corpus benchmark preserved; scoped access/no-answer checks reported separately",
    limits:
      "Forced HNSW plan tests operator/index compatibility; it does not establish large-corpus latency or joined query planner choice",
  };
  await writeFile("docs/release/RETRIEVAL_EDGES.json", JSON.stringify(result, null, 2) + "\n");
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
