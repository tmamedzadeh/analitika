import { and, arrayContains, eq } from "drizzle-orm";

import type { AnalyticsFilters } from "../src/lib/analytics";
import { retrievalEvalQuestions } from "../src/server/analytics/retrieval-eval-questions";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { getAppConfig } from "../src/server/config";
import { closeDb, getDb } from "../src/server/db";
import { accessFilter } from "../src/server/db/access";
import { chunks, documents } from "../src/server/db/schema";
import { searchDocumentChunks } from "../src/server/analytics/search";

const filters: AnalyticsFilters = {
  period: "all",
  tag: "demo-synthetic",
  departmentIds: ["d1", "d2", "d3", "d4", "d5"],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

async function evaluate(): Promise<void> {
  if (
    retrievalEvalQuestions.length !== 40 ||
    retrievalEvalQuestions.filter(({ expectedDocumentIds }) => expectedDocumentIds.length === 0)
      .length !== 5
  ) {
    throw new Error(
      "Retrieval evaluation data must contain 40 questions and 5 out-of-corpus cases.",
    );
  }

  const db = getDb();
  const rows = await db
    .select({ id: chunks.id })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(and(arrayContains(documents.tags, ["demo-synthetic"]), accessFilter()));
  if (!rows.length) throw new Error("No demo chunks found; run db:seed:demo first.");

  const config = getAppConfig();
  const embeddings = createGeminiProviders().embeddings;
  const started = Date.now();
  const queryVectors = await embeddings.embedQueries(
    retrievalEvalQuestions.map(({ query }) => query),
    { maxAttempts: 1 },
  );
  if (
    queryVectors.length !== retrievalEvalQuestions.length ||
    queryVectors.some((vector) => vector.length !== config.embeddingDimensions)
  ) {
    throw new Error("Gemini returned an unexpected embedding shape.");
  }

  let hit3 = 0;
  let hit5 = 0;
  let hit10 = 0;
  let reciprocalRankTotal = 0;
  let retrievalMs = 0;
  for (const [index, question] of retrievalEvalQuestions.entries()) {
    const queryStarted = Date.now();
    const results = await searchDocumentChunks(question.query, filters, {
      embedding: queryVectors[index],
      embeddingModel: embeddings.model,
      enableRerank: false,
      maxEmbeddingAttempts: 1,
    });
    retrievalMs += Date.now() - queryStarted;
    const rank = results.findIndex((result) =>
      question.expectedDocumentIds.includes(result.documentId),
    );
    if (rank < 0) continue;
    if (rank < 3) hit3 += 1;
    if (rank < 5) hit5 += 1;
    if (rank < 10) hit10 += 1;
    reciprocalRankTotal += 1 / (rank + 1);
  }
  const count = retrievalEvalQuestions.length;
  console.table([
    {
      provider: "Gemini",
      model: embeddings.model,
      questions: count,
      "no-answer cases": retrievalEvalQuestions.filter((item) => !item.expectedDocumentIds.length)
        .length,
      "Hit@3": `${((hit3 / count) * 100).toFixed(1)}%`,
      "Hit@5": `${((hit5 / count) * 100).toFixed(1)}%`,
      "Hit@10": `${((hit10 / count) * 100).toFixed(1)}%`,
      MRR: (reciprocalRankTotal / count).toFixed(3),
      "avg retrieval ms": Math.round(retrievalMs / count),
      "avg total ms": Math.round((Date.now() - started) / count),
      "embedding API calls": embeddings.usage.apiCalls,
      "input tokens": embeddings.usage.inputTokens || "not reported by provider",
    },
  ]);
  console.log(
    "Small synthetic corpus; results are directional, not a production quality estimate.",
  );
}

try {
  await evaluate();
} catch {
  console.error(
    "Retrieval evaluation stopped. Check database access, demo data, and Gemini quota.",
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
