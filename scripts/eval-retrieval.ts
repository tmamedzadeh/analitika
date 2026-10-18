import type { AnalyticsFilters } from "../src/lib/analytics";
import { az } from "../src/lib/i18n/az";
import { departments } from "../src/lib/departments";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { closeDb } from "../src/server/db";
import { validateCitations } from "../src/server/analytics/citations";
import { searchDocumentChunks } from "../src/server/analytics/search";
import { buildAnalyticsPrompt } from "../src/server/prompts/analytics";
import { getAppConfig } from "../src/server/config";

const query = "Rusiya tərəfindən PUA";
const filters: AnalyticsFilters = {
  period: "all",
  tag: "",
  departmentIds: departments.map(({ id }) => id),
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

function usedCitationCount(answer: string, sourceCount: number): number {
  const used = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= sourceCount) used.add(n);
  }
  return used.size;
}

async function evaluateSeededSearch(): Promise<void> {
  const providers = createGeminiProviders();
  const sources = await searchDocumentChunks(query, filters);
  let answer = az.analytics.noSources;
  let incomplete = false;
  if (sources.length > 0) {
    const prompt = buildAnalyticsPrompt(query, sources, getAppConfig().analyticsThinkingLevel);
    let generated = "";
    for await (const part of await providers.analytics.streamText(prompt)) generated += part;
    const validated = validateCitations(generated, sources, prompt.lowReliabilityWarning);
    answer = validated.answer;
    incomplete = validated.incomplete;
  }

  const result = {
    status: sources.length ? "ok" : "no_sources",
    sourceCount: sources.length,
    sourceKinds: [...new Set(sources.map((source) => source.sourceKind))].sort(),
    answerChars: answer.length,
    answerWords: answer.trim() ? answer.trim().split(/\s+/u).length : 0,
    usedSources: usedCitationCount(answer, sources.length),
    citationsValid: !incomplete,
  };
  console.log(JSON.stringify(result));
  if (sources.length === 0) process.exitCode = 1;
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
    if (typeof value.name === "string") errorTypes.push(value.name);
    if (providerStatus === undefined) {
      if (typeof value.statusCode === "number") providerStatus = value.statusCode;
      else if (typeof value.status === "number") providerStatus = value.status;
    }
    if (
      connectionCode === undefined &&
      typeof value.code === "string" &&
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(value.code)
    ) {
      connectionCode = value.code;
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
