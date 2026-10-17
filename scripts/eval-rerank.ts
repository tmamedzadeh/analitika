import { and, eq, inArray } from "drizzle-orm";

import { analyticsFiltersSchema } from "../src/lib/analytics";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { GeminiRerankProvider } from "../src/server/ai/rerank";
import { closeDb, getDb } from "../src/server/db";
import { chunks, documents } from "../src/server/db/schema";
import { searchDocumentChunks } from "../src/server/analytics/search";

const demoDocumentIds = [
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0001",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0002",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0003",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0004",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0005",
  "e632b7bf-2e8f-4b0f-8bc7-3c01f2fd0006",
] as const;

const evaluationCases = [
  { query: "Park pilotində suvarma qrafiki hansı vaxta keçirildi?", target: demoDocumentIds[0] },
  {
    query: "Parklarda suvarma vaxtının dəyişməsi bitkilərə necə təsir etdi?",
    target: demoDocumentIds[0],
  },
  { query: "Nümunə ölçməsində su sərfi neçə faiz azaldı?", target: demoDocumentIds[0] },
  { query: "Park pilot sənədində əsas nəticə nə idi?", target: demoDocumentIds[0] },
  { query: "Üç məhəllədə su təchizatı müraciətləri nə ilə bağlı idi?", target: demoDocumentIds[1] },
  { query: "Axşam su təzyiqinin azalması barədə nə müşahidə edildi?", target: demoDocumentIds[1] },
  {
    query: "Təzyiq ölçülməsi nasazlıq nöqtələrini tapmağa necə kömək etdi?",
    target: demoDocumentIds[1],
  },
  {
    query: "Su şəbəkəsində nasazlıq yerləri hansı sınaqla müəyyən olundu?",
    target: demoDocumentIds[1],
  },
  { query: "Anonim məktub suvarma layihəsi barədə nə iddia edirdi?", target: demoDocumentIds[2] },
  { query: "Məhsuldarlığın ikiqat artması iddiasının mənbəyi nə idi?", target: demoDocumentIds[2] },
  { query: "Məktubun müəllifi və ölçmə üsulu məlum idimi?", target: demoDocumentIds[2] },
  {
    query: "Kənd təsərrüfatında məhsuldarlıq artımı təsdiqlənmişdimi?",
    target: demoDocumentIds[2],
  },
  {
    query: "Pik saatlarda avtobus gözləmə müddəti əvvəl neçə dəqiqə idi?",
    target: demoDocumentIds[3],
  },
  {
    query: "Əlavə avtobusdan sonra gözləmə müddəti neçə dəqiqəyə düşdü?",
    target: demoDocumentIds[3],
  },
  {
    query: "Marşrut cədvəlində müşahidə müddəti neçə iş günü göstərilib?",
    target: demoDocumentIds[3],
  },
  { query: "Cədvələ görə pik saat gözləmə göstəricisi necə dəyişdi?", target: demoDocumentIds[3] },
  { query: "Damcı suvarma suyu bitkinin hansı hissəsinə çatdırır?", target: demoDocumentIds[4] },
  { query: "Nümunə sahəsində su sərfi ilə bağlı nə qeydə alındı?", target: demoDocumentIds[4] },
  {
    query: "Kitabxana elektron kataloqdan başqa hansı xidməti sınadı?",
    target: demoDocumentIds[5],
  },
  {
    query: "İlk ayın cədvəlində neçə nəfər kataloqa baxıb və neçə nəfər sifariş verdi?",
    target: demoDocumentIds[5],
  },
] as const;

const filters = analyticsFiltersSchema.parse({
  period: "all",
  tag: "demo-synthetic",
  departmentIds: ["d1", "d2", "d3", "d4", "d5"],
  minSourceReliability: "all",
  minInfoCredibility: "all",
});

type Metrics = {
  top3: number;
  top5: number;
  top10: number;
  mrr: number;
  latencyMs: number;
};

function metrics(
  results: Array<{ documentId: string; chunkId: string }>,
  target: string,
  latencyMs: number,
): Metrics {
  const rank = results.findIndex(
    (source) => source.documentId === target || source.chunkId === target,
  );
  return {
    top3: Number(rank >= 0 && rank < 3),
    top5: Number(rank >= 0 && rank < 5),
    top10: Number(rank >= 0 && rank < 10),
    mrr: rank < 0 ? 0 : 1 / (rank + 1),
    latencyMs,
  };
}

function summarize(rows: Metrics[]) {
  const total = rows.length;
  return {
    top3: rows.reduce((sum, row) => sum + row.top3, 0) / total,
    top5: rows.reduce((sum, row) => sum + row.top5, 0) / total,
    top10: rows.reduce((sum, row) => sum + row.top10, 0) / total,
    mrr: rows.reduce((sum, row) => sum + row.mrr, 0) / total,
    latencyMs: rows.reduce((sum, row) => sum + row.latencyMs, 0) / total,
  };
}

const db = getDb();

try {
  const readyDemoDocs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.id, [...demoDocumentIds]), eq(documents.status, "ready")));
  if (readyDemoDocs.length !== demoDocumentIds.length) {
    throw new Error("Seed the six synthetic demo documents before running rerank evaluation.");
  }

  const tableChunks = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(inArray(chunks.documentId, [...demoDocumentIds]), eq(chunks.isTable, true)));
  if (tableChunks.length < 2) {
    throw new Error("Refresh the demo seed so the evaluation includes its synthetic table chunks.");
  }

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
    const baselineResult = await searchDocumentChunks(evaluationCase.query, filters, {
      embedding,
      enableRerank: false,
    });
    baseline.push(
      metrics(baselineResult, evaluationCase.target, performance.now() - baselineStarted),
    );

    const rerankedStarted = performance.now();
    const rerankedResult = await searchDocumentChunks(evaluationCase.query, filters, {
      embedding,
      enableRerank: true,
      rerankProvider: countedProvider,
    });
    reranked.push(
      metrics(rerankedResult, evaluationCase.target, performance.now() - rerankedStarted),
    );
  }

  const before = summarize(baseline);
  const after = summarize(reranked);
  const addedLatencyMs = after.latencyMs - before.latencyMs;
  console.log(
    `Synthetic corpus: ${readyDemoDocs.length} documents, ${tableChunks.length} table chunks, ${evaluationCases.length} Azerbaijani queries.`,
  );
  console.table([
    {
      mode: "RRF without rerank",
      "hit@3": `${(before.top3 * 100).toFixed(1)}%`,
      "hit@5": `${(before.top5 * 100).toFixed(1)}%`,
      "hit@10": `${(before.top10 * 100).toFixed(1)}%`,
      MRR: before.mrr.toFixed(3),
      "avg search ms": before.latencyMs.toFixed(0),
      "extra LLM calls": 0,
    },
    {
      mode: "RRF + Gemini LIGHT rerank",
      "hit@3": `${(after.top3 * 100).toFixed(1)}%`,
      "hit@5": `${(after.top5 * 100).toFixed(1)}%`,
      "hit@10": `${(after.top10 * 100).toFixed(1)}%`,
      MRR: after.mrr.toFixed(3),
      "avg search ms": after.latencyMs.toFixed(0),
      "extra LLM calls": rerankCalls,
    },
  ]);
  console.log(
    `Average added latency: ${addedLatencyMs.toFixed(0)} ms. Gemini API requests: 1 batched query-embedding request + ${rerankCalls} rerank request(s) = ${1 + rerankCalls} (maximum 21 for this evaluation).`,
  );
  console.log(
    "Corpus and metrics are small-sample estimates; do not generalize to production workloads.",
  );
} finally {
  await closeDb();
}
