import { eq } from "drizzle-orm";
import { retrievalMetrics } from "../src/server/analytics/retrieval-metrics";

import { analyticsFiltersSchema } from "../src/lib/analytics";
import { directions } from "../src/lib/directions";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { GeminiRerankProvider } from "../src/server/ai/rerank";
import { closeDb, getDb } from "../src/server/db";
import { dailyBriefs, documents } from "../src/server/db/schema";
import { searchDocumentChunks } from "../src/server/analytics/search";
import {
  requireProjectEvaluationDatabase,
  withProjectEvaluationUser,
} from "../src/server/evaluation-safety";
import { retrievalEvalQuestions } from "../src/server/analytics/retrieval-eval-questions";

const evaluationCases = retrievalEvalQuestions
  .filter((item) => !item.noAnswer && item.expectedSources.length > 0)
  .map((item) => ({ query: item.query, targetLabels: item.expectedSources }));

const filters = analyticsFiltersSchema.parse({
  period: "all",
  directionIds: directions.map(({ id }) => id),
  minSourceReliability: "all",
  minInfoCredibility: "all",
});

type Metrics = {
  recall5: number;
  recall10: number;
  mrr: number;
  ndcg: number;
  latencyMs: number;
};

function metrics(
  results: Array<{ documentId: string | null; briefId: string | null }>,
  targets: Set<string>,
  latencyMs: number,
): Metrics {
  return { ...retrievalMetrics(results, targets), latencyMs };
}
function summarize(rows: Metrics[]) {
  const total = rows.length;
  return {
    recall5: rows.reduce((sum, row) => sum + row.recall5, 0) / total,
    recall10: rows.reduce((sum, row) => sum + row.recall10, 0) / total,
    mrr: rows.reduce((sum, row) => sum + row.mrr, 0) / total,
    ndcg: rows.reduce((sum, row) => sum + row.ndcg, 0) / total,
    latencyMs: rows.reduce((sum, row) => sum + row.latencyMs, 0) / total,
  };
}

requireProjectEvaluationDatabase();
const db = getDb();

try {
  const stableTargets = new Map<
    string,
    { kind: "brief" | "document"; date: string; title: RegExp }
  >([
    ["brief:2026-10-18:drone", { kind: "brief", date: "2026-10-18", title: /PUA|pilotsuz/iu }],
    ["brief:2026-10-18:minister", { kind: "brief", date: "2026-10-18", title: /nazir|İran/iu }],
    ["brief:2026-10-17:budget", { kind: "brief", date: "2026-10-17", title: /büdcə|Ermənistan/iu }],
    ["brief:2026-10-17:territorial", { kind: "brief", date: "2026-10-17", title: /ərazi/iu }],
    ["brief:2026-10-16:hormuz", { kind: "brief", date: "2026-10-16", title: /Hörmüz/iu }],
    ["brief:2026-10-15:missile", { kind: "brief", date: "2026-10-15", title: /raket/iu }],
    [
      "brief:2026-10-14:diversification",
      { kind: "brief", date: "2026-10-14", title: /şaxələndirmə|Ermənistan/iu },
    ],
    ["brief:2026-10-13:industry", { kind: "brief", date: "2026-10-13", title: /sənaye|Rusiya/iu }],
    [
      "brief:2026-10-12:reconstitution",
      { kind: "brief", date: "2026-10-12", title: /bərpa|İran/iu },
    ],
    ["brief:2026-10-11:caucasus", { kind: "brief", date: "2026-10-11", title: /Ermənistan/iu }],
    [
      "document:2026-10-15:drone",
      { kind: "document", date: "2026-10-15", title: /PUA|pilotsuz/iu },
    ],
    [
      "document:2026-07-14:industry",
      { kind: "document", date: "2026-07-14", title: /sənaye|Rusiya/iu },
    ],
    [
      "document:2026-09-28:budget",
      { kind: "document", date: "2026-09-28", title: /büdcə|Rusiya/iu },
    ],
    [
      "document:2026-08-25:strike",
      { kind: "document", date: "2026-08-25", title: /zərbə|Rusiya/iu },
    ],
    [
      "document:2026-10-18:reconstitution",
      { kind: "document", date: "2026-10-18", title: /bərpa|İran/iu },
    ],
    ["document:2026-10-18:hormuz", { kind: "document", date: "2026-10-18", title: /Hörmüz/iu }],
    [
      "document:2026-06-23:missile",
      { kind: "document", date: "2026-06-23", title: /raket|İran/iu },
    ],
    [
      "document:2026-10-01:budget",
      { kind: "document", date: "2026-10-01", title: /büdcə|Ermənistan/iu },
    ],
    [
      "document:2026-08-18:diversification",
      { kind: "document", date: "2026-08-18", title: /şaxələndirmə|Ermənistan/iu },
    ],
    [
      "document:2026-09-30:armenia-russia",
      { kind: "document", date: "2026-09-30", title: /Ermənistan|Rusiya/iu },
    ],
  ]);
  const resolved = new Map<string, string>();
  for (const [label, target] of stableTargets) {
    const rows =
      target.kind === "brief"
        ? await db
            .select({ id: dailyBriefs.id, title: dailyBriefs.title })
            .from(dailyBriefs)
            .where(eq(dailyBriefs.briefDate, target.date))
        : await db
            .select({ id: documents.id, title: documents.title })
            .from(documents)
            .where(eq(documents.docDate, target.date));
    const matches = rows.filter(({ title }) => target.title.test(title));
    if (matches.length === 1)
      resolved.set(label, `${target.kind === "brief" ? "brief" : "document"}:${matches[0]!.id}`);
  }
  const unresolved = [...stableTargets.keys()].filter((label) => !resolved.has(label));
  if (unresolved.length)
    throw new Error(`Stable labels unresolved (${unresolved.length}); benchmark metrics withheld.`);
  const providers = createGeminiProviders();
  const vectors = await providers.embeddings.embedQueries(
    evaluationCases.map(({ query }) => query),
    { maxAttempts: 1 },
  );
  if (
    vectors.length !== evaluationCases.length ||
    vectors.some(
      (vector) => vector.length !== 768 || vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("Evaluation query embeddings must contain 768 finite dimensions.");
  }

  const baseline: Metrics[] = [];
  const reranked: Metrics[] = [];
  let rerankCalls = 0;
  const provider = new GeminiRerankProvider(providers.light);
  const countedProvider = {
    async rerank(
      query: string,
      candidates: Parameters<typeof provider.rerank>[1],
      options?: Parameters<typeof provider.rerank>[2],
    ) {
      rerankCalls += 1;
      if (rerankCalls > 20) throw new Error("Rerank evaluation exceeded its 20-call cap.");
      return provider.rerank(query, candidates, options);
    },
  };

  for (const [index, evaluationCase] of evaluationCases.entries()) {
    const embedding = vectors[index]!;
    const baselineStarted = performance.now();
    const baselineResult = await withProjectEvaluationUser(() =>
      searchDocumentChunks(evaluationCase.query, filters, {
        embedding,
        enableRerank: false,
      }),
    );
    const expected = new Set(evaluationCase.targetLabels.map((label) => resolved.get(label)!));
    baseline.push(metrics(baselineResult, expected, performance.now() - baselineStarted));

    const rerankedStarted = performance.now();
    const rerankedResult = await withProjectEvaluationUser(() =>
      searchDocumentChunks(evaluationCase.query, filters, {
        embedding,
        enableRerank: true,
        rerankProvider: countedProvider,
      }),
    );
    reranked.push(metrics(rerankedResult, expected, performance.now() - rerankedStarted));
  }

  const before = summarize(baseline);
  const after = summarize(reranked);
  const addedLatencyMs = after.latencyMs - before.latencyMs;
  console.log(
    `Configured corpus: read-only project DB; ${evaluationCases.length} answerable benchmark queries; ${resolved.size} stable labels resolved. Query text embeddings and rerank prompts are sent to configured providers; use only data approved for those providers.`,
  );
  console.table([
    {
      mode: "RRF without rerank",
      "Recall@5": `${(before.recall5 * 100).toFixed(1)}%`,
      "Recall@10": `${(before.recall10 * 100).toFixed(1)}%`,
      MRR: before.mrr.toFixed(3),
      nDCG: before.ndcg.toFixed(3),
      "avg search ms": before.latencyMs.toFixed(0),
      "extra LLM calls": 0,
    },
    {
      mode: "RRF + Gemini LIGHT rerank",
      "Recall@5": `${(after.recall5 * 100).toFixed(1)}%`,
      "Recall@10": `${(after.recall10 * 100).toFixed(1)}%`,
      MRR: after.mrr.toFixed(3),
      nDCG: after.ndcg.toFixed(3),
      "avg search ms": after.latencyMs.toFixed(0),
      "extra LLM calls": rerankCalls,
    },
  ]);
  console.log(
    `Average added latency: ${addedLatencyMs.toFixed(0)} ms. Gemini API requests: 1 batched query-embedding request + ${rerankCalls} rerank request(s) = ${1 + rerankCalls}.`,
  );
  console.log(
    "Corpus and metrics are small-sample estimates; do not generalize to production workloads.",
  );
} finally {
  await closeDb();
}
