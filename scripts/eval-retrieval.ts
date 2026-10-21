import { eq } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { retrievalMetrics } from "../src/server/analytics/retrieval-metrics";
import type { AnalyticsFilters } from "../src/lib/analytics";
import { directions } from "../src/lib/directions";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { closeDb, getDb } from "../src/server/db";
import { dailyBriefs, documents } from "../src/server/db/schema";
import {
  retrievalEvalQuestions,
  retrievalEvalSources,
} from "../src/server/analytics/retrieval-eval-questions";
import { searchDocumentChunks } from "../src/server/analytics/search";
import {
  requireProjectEvaluationDatabase,
  withProjectEvaluationUser,
} from "../src/server/evaluation-safety";

requireProjectEvaluationDatabase();

const db = getDb();
const labelTargets = new Map<string, { kind: "document" | "brief"; date: string; title: RegExp }>([
  [
    retrievalEvalSources.briefDroneBase,
    { kind: "brief", date: "2026-10-18", title: /PUA|pilotsuz|drone/iu },
  ],
  [
    retrievalEvalSources.briefIranMinister,
    { kind: "brief", date: "2026-10-18", title: /nazir|İran/iu },
  ],
  [
    retrievalEvalSources.briefArmeniaBudget,
    { kind: "brief", date: "2026-10-17", title: /Ermənistan|büdcə/iu },
  ],
  [
    retrievalEvalSources.briefTerritorialClaims,
    { kind: "brief", date: "2026-10-17", title: /ərazi|iddia/iu },
  ],
  [retrievalEvalSources.briefHormuz, { kind: "brief", date: "2026-10-16", title: /Hörmüz/iu }],
  [
    retrievalEvalSources.briefIranMissiles,
    { kind: "brief", date: "2026-10-15", title: /raket|İran/iu },
  ],
  [
    retrievalEvalSources.briefArmeniaDiversification,
    { kind: "brief", date: "2026-10-14", title: /Ermənistan|şaxələndirmə/iu },
  ],
  [
    retrievalEvalSources.briefRussiaIndustry,
    { kind: "brief", date: "2026-10-13", title: /Rusiya|sənaye/iu },
  ],
  [
    retrievalEvalSources.briefIranReconstitution,
    { kind: "brief", date: "2026-10-12", title: /İran|bərpa/iu },
  ],
  [
    retrievalEvalSources.briefSouthCaucasus,
    { kind: "brief", date: "2026-10-11", title: /Ermənistan|Qafqaz/iu },
  ],
  [
    retrievalEvalSources.docDroneBase,
    { kind: "document", date: "2026-10-15", title: /PUA|pilotsuz|drone/iu },
  ],
  [
    retrievalEvalSources.docRussiaIndustry,
    { kind: "document", date: "2026-07-14", title: /Rusiya|sənaye/iu },
  ],
  [
    retrievalEvalSources.docRussiaBudget,
    { kind: "document", date: "2026-09-28", title: /Rusiya|büdcə/iu },
  ],
  [
    retrievalEvalSources.docStrikeCampaign,
    { kind: "document", date: "2026-08-25", title: /Rusiya|zərbə/iu },
  ],
  [
    retrievalEvalSources.docIranReconstitution,
    { kind: "document", date: "2026-10-18", title: /İran|bərpa/iu },
  ],
  [retrievalEvalSources.docHormuz, { kind: "document", date: "2026-10-18", title: /Hörmüz/iu }],
  [
    retrievalEvalSources.docIranMissiles,
    { kind: "document", date: "2026-06-23", title: /İran|raket/iu },
  ],
  [
    retrievalEvalSources.docArmeniaBudget,
    { kind: "document", date: "2026-10-01", title: /Ermənistan|büdcə/iu },
  ],
  [
    retrievalEvalSources.docArmeniaDiversification,
    { kind: "document", date: "2026-08-18", title: /Ermənistan|şaxələndirmə/iu },
  ],
  [
    retrievalEvalSources.docArmeniaRussia,
    { kind: "document", date: "2026-09-30", title: /Ermənistan|Rusiya/iu },
  ],
]);
const filters: AnalyticsFilters = {
  period: "all",
  directionIds: directions.map(({ id }) => id),
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

type MetricRow = { recall5: number; recall10: number; mrr: number; ndcg: number };
async function resolveLabels(): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const [label, target] of labelTargets) {
    const records =
      target.kind === "brief"
        ? await db
            .select({ id: dailyBriefs.id, title: dailyBriefs.title })
            .from(dailyBriefs)
            .where(eq(dailyBriefs.briefDate, target.date))
        : await db
            .select({ id: documents.id, title: documents.title })
            .from(documents)
            .where(eq(documents.docDate, target.date));
    const matches = records.filter(({ title }) => target.title.test(title));
    if (matches.length === 1)
      resolved.set(label, `${target.kind === "brief" ? "brief" : "document"}:${matches[0]!.id}`);
  }
  return resolved;
}

async function evaluateSeededSearch(): Promise<void> {
  const resolved = await resolveLabels();
  const rows: Array<
    MetricRow & {
      query: string;
      category: string;
      noAnswer: boolean;
      emptyResult: boolean;
      expectedSourceCount: number;
      labelsResolved: boolean;
    }
  > = [];
  for (const item of retrievalEvalQuestions) {
    console.error(`[eval] ${item.query}`);
    const labelsResolved = item.expectedSources.every((label) => resolved.has(label));
    const expected = new Set(
      item.expectedSources
        .map((label) => resolved.get(label))
        .filter((id): id is string => Boolean(id)),
    );
    if (!labelsResolved)
      throw new Error("Gold source labels must resolve uniquely before evaluation.");
    const sources = await withProjectEvaluationUser(() =>
      searchDocumentChunks(item.query, {
        ...filters,
        ...(item.filters?.period === "30d" ? { period: "30d" as const } : {}),
        ...(item.filters?.directionIds
          ? { directionIds: item.filters.directionIds as AnalyticsFilters["directionIds"] }
          : {}),
      }),
    );
    rows.push({
      ...retrievalMetrics(sources, expected),
      query: item.query,
      category:
        item.sourceKind ?? (item.expectedSources.length > 1 ? "cross-source" : "answerable"),
      noAnswer: !!item.noAnswer,
      emptyResult: sources.length === 0,
      expectedSourceCount: expected.size,
      labelsResolved,
    });
  }
  const scored = rows.filter((row) => !row.noAnswer && row.labelsResolved);
  const average = (metric: keyof MetricRow) =>
    scored.length ? scored.reduce((sum, row) => sum + row[metric], 0) / scored.length : null;
  const result = JSON.stringify(
    {
      corpus: "configured project database",
      evaluation:
        "read-only retrieval; query embeddings are sent to configured embedding provider; no source text or answer generation is sent externally",
      queryCount: rows.length,
      resolvedStableSourceLabels: resolved.size,
      unresolvedStableSourceLabels: [...labelTargets.keys()].filter((label) => !resolved.has(label))
        .length,
      scoredAnswerableQueries: scored.length,
      metrics: {
        RecallAt5: average("recall5"),
        RecallAt10: average("recall10"),
        MRR: average("mrr"),
        nDCG: average("ndcg"),
      },
      noAnswerCases: rows.filter((row) => row.noAnswer).length,
      noAnswerEmptyResults: rows.filter((row) => row.noAnswer && row.emptyResult).length,
      // Non-relevance diagnostic: how many answerable queries returned nothing at all.
      answerableEmptyResults: rows.filter((row) => !row.noAnswer && row.emptyResult).length,
      rerankEnabled: process.env["ENABLE_RERANK"] === "true",
      goldSources: Object.fromEntries(resolved),
      perCase: rows.map(
        ({
          query,
          category,
          noAnswer,
          emptyResult,
          expectedSourceCount,
          labelsResolved,
          ...score
        }) => ({
          query,
          category,
          noAnswer,
          emptyResult,
          expectedSourceCount,
          labelsResolved,
          ...score,
        }),
      ),
    },
    null,
    2,
  );
  const output = process.argv[2];
  if (output) await writeFile(output, result + "\n");
  console.log(result);
}

try {
  await evaluateSeededSearch();
} catch (error) {
  let providerStatus: number | undefined;
  let connectionCode: string | undefined;
  const errorTypes: string[] = [];
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  while (queue.length && visited.size < 8) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    const value = current as Record<string, unknown>;
    if (typeof value["name"] === "string") errorTypes.push(value["name"]);
    if (providerStatus === undefined) {
      if (typeof value["statusCode"] === "number") providerStatus = value["statusCode"];
      else if (typeof value["status"] === "number") providerStatus = value["status"];
    }
    if (
      connectionCode === undefined &&
      typeof value["code"] === "string" &&
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(value["code"])
    ) {
      connectionCode = value["code"];
    }
    for (const key of ["cause", "lastError", "errors", "failure"]) {
      const nested = value[key];
      if (Array.isArray(nested)) queue.push(...nested);
      else if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  console.error(
    JSON.stringify({
      status: "failed",
      errorTypes,
      ...(providerStatus === undefined ? {} : { providerStatus }),
      ...(connectionCode ? { connectionCode } : {}),
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
