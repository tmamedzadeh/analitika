import type { AnalyticsFilters, AnalyticsSource } from "../src/lib/analytics";
import { briefRouteForSearchSource } from "../src/lib/briefs";
import { departments } from "../src/lib/departments";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { closeDb } from "../src/server/db";
import { searchDocumentChunks } from "../src/server/analytics/search";

const query = "Rusiya Rostov vilayətində PUA buraxılış bazası və buraxılış infrastrukturu";
const filters: AnalyticsFilters = {
  period: "all",
  tag: "",
  departmentIds: departments.map(({ id }) => id),
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

function citation(source: AnalyticsSource): string {
  const href = briefRouteForSearchSource(source);
  return [
    `${source.sourceKind}: ${source.title}`,
    `  route=${href ?? "unavailable"}`,
    `  fragment=${source.charStart}-${source.charEnd}; quote=${source.quote}`,
  ].join("\n");
}

async function verifySeededSearch(): Promise<void> {
  const embeddings = createGeminiProviders().embeddings;
  const queryEmbedding = await embeddings.embedQuery(query, { maxAttempts: 1 });
  if (queryEmbedding.length !== 768 || queryEmbedding.some((value) => !Number.isFinite(value))) {
    throw new Error("The query embedding provider did not return 768 finite dimensions.");
  }
  const results = await searchDocumentChunks(query, filters, {
    embedding: queryEmbedding,
    embeddingModel: embeddings.model,
    enableRerank: false,
    maxEmbeddingAttempts: 1,
  });
  const document = results.find((source) => source.sourceKind === "document");
  const brief = results.find((source) => source.sourceKind === "brief");
  if (!document || !brief) {
    throw new Error(
      `Search smoke query must return both a document and a published brief; result types were ${results.map((source) => source.sourceKind).join(", ") || "none"}.`,
    );
  }
  console.log(`Search smoke query: ${query}`);
  console.log(`Embedding model: ${embeddings.model}; results=${results.length}`);
  console.log("Citation and source fragment:");
  console.log(citation(document));
  console.log(citation(brief));
  console.log(
    "Search verification passed: documents and published briefs are retrievable with fragment routes.",
  );
}

try {
  await verifySeededSearch();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Search verification failed: ${message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
