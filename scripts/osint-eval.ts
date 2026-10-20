import { readFile, writeFile } from "node:fs/promises";

import { ExaProvider, SearchRequestBudget } from "../src/server/ai/exa";
import { HasDataProvider } from "../src/server/ai/hasdata";
import { TavilyProvider } from "../src/server/ai/tavily";
import type { SearchProvider, SearchProviderId, SearchSource } from "../src/server/ai/types";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { readServerEnv } from "../src/server/env";
import {
  OSINT_LANGUAGES,
  osintLanguageLocale,
  osintLanguageNames,
  type OsintLanguage,
  type OsintPeriod,
} from "../src/lib/osint";
import { fetchPublicPage } from "../src/server/osint/fetch-public-page";
import { dedupeSearchSources, reciprocalRankFusion } from "../src/server/osint/ranking";
import { looksAzerbaijani } from "../src/server/osint/language";
import { sourceSummaryBatchSchema } from "../src/server/osint/reports";
import { queryExpansionsSchema } from "../src/server/osint/query-expansion";
import {
  getPeriodStart,
  matchesOsintLanguageScript,
  normalizeOsintUrl,
} from "../src/server/osint/urls";

type SeedSource = { domain: string };
type SeedRun = { query: string; period: OsintPeriod; sources: SeedSource[] };
type SearchSet = { provider: SearchProviderId; results: SearchSource[] };
type Pair = { queryIndex: number; language: OsintLanguage };

const seedPath = "zirve_military_seed_data_2026-10-18.json";
const requestLimit = Math.max(1, Math.min(24, Number(process.env.OSINT_MAX_SEARCH_REQUESTS ?? 24)));
const requestedQueries = Math.min(8, Math.max(1, Number(process.env.OSINT_EVAL_QUERIES ?? 3)));
const pageCheckLimit = 24;
const hasDataLanguages: OsintLanguage[] = ["fa", "hy", "ka", "zh"];
function readArgument(name: string): string | undefined {
  const prefix = "--" + name + "=";
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function concurrent<T, U>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        output[index] = await fn(values[index]!);
      }
    }),
  );
  return output;
}

function domainFor(source: SearchSource): string | null {
  const normalized = normalizeOsintUrl(source.url);
  return normalized ? new URL(normalized).hostname : null;
}

async function main(): Promise<void> {
  const env = readServerEnv();
  if (!env.EXA_API_KEY) throw new Error("EXA_API_KEY is required for provider evaluation.");
  if (!env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is required for provider evaluation.");
  if (!env.HASDATA_API_KEY) throw new Error("HASDATA_API_KEY is required for provider evaluation.");

  const seed = JSON.parse(await readFile(seedPath, "utf8")) as { osintRuns: SeedRun[] };
  const runs = seed.osintRuns.slice(0, requestedQueries);
  if (!runs.length) throw new Error("No seed queries were found.");
  const ai = createGeminiProviders();
  const providers: SearchProvider[] = [
    new ExaProvider(env.EXA_API_KEY),
    new TavilyProvider(env.TAVILY_API_KEY),
    new HasDataProvider(env.HASDATA_API_KEY, env.HASDATA_MODE),
  ];
  const budgets = new Map(
    providers.map((provider) => [provider.provider, new SearchRequestBudget(requestLimit)]),
  );
  const data = new Map<string, SearchSet[]>();
  const seedDomains = new Map<number, Set<string>>();
  const pairList: Pair[] = [];
  const providerErrors = new Map<SearchProviderId, number>();
  const successfulLanguages = new Map<SearchProviderId, Set<OsintLanguage>>();
  const responseTimes = new Map<SearchProviderId, { totalMs: number; operations: number }>();
  const started = Date.now();
  let expansionCalls = 0;
  let expansionFailures = 0;
  let expansionDurationMs = 0;

  for (const [queryIndex, run] of runs.entries()) {
    seedDomains.set(queryIndex, new Set(run.sources.map((source) => source.domain.toLowerCase())));
    let translations: Record<OsintLanguage, string>;
    const expansionStartedAt = Date.now();
    try {
      const expansions = await ai.osint.generateObject(
        {
          temperature: 0,
          timeoutMs: 12_000,
          maxAttempts: 2,
          maxOutputTokens: 500,
          thinkingLevel: env.OSINT_THINKING_LEVEL,
          telemetryStep: "expansion",
          prompt: [
            "Expand the research query into one concise main search query and up to two useful variants for every requested language. For az, main must equal the original query exactly; variants are Azerbaijani synonyms or alternative phrasings. Keep people, places and dates. Do not answer the query.",
            JSON.stringify({
              query: run.query,
              languages: OSINT_LANGUAGES.map((language) => ({
                code: language,
                name: osintLanguageNames[language],
              })),
            }),
          ].join("\n\n"),
        },
        queryExpansionsSchema(OSINT_LANGUAGES),
      );
      translations = Object.fromEntries(
        OSINT_LANGUAGES.map((language) => [language, expansions[language].main]),
      ) as Record<OsintLanguage, string>;
      translations.az = run.query;
      expansionCalls += 1;
    } catch {
      expansionFailures += 1;
      translations = Object.fromEntries(
        OSINT_LANGUAGES.map((language) => [language, run.query]),
      ) as Record<OsintLanguage, string>;
    } finally {
      expansionDurationMs += Date.now() - expansionStartedAt;
    }

    const tasks = OSINT_LANGUAGES.flatMap((language) => {
      pairList.push({ queryIndex, language });
      return providers
        .filter(
          (provider) => provider.provider !== "hasdata" || hasDataLanguages.includes(language),
        )
        .map((provider) => ({ provider, language }));
    });
    await concurrent(tasks, 4, async ({ provider, language }) => {
      const budget = budgets.get(provider.provider)!;
      const pairKey = queryIndex + ":" + language;
      if (budget.calls >= budget.maxCalls) return;
      const requestStartedAt = Date.now();
      try {
        const since = getPeriodStart(run.period);
        const sources = await provider.search({
          query: translations[language] || run.query,
          language,
          country: osintLanguageLocale[language].country,
          userLocation: osintLanguageLocale[language].country,
          numResults: 10,
          limit: 10,
          ...(since
            ? { startPublishedDate: since, endPublishedDate: new Date().toISOString() }
            : {}),
          timeoutMs: 15_000,
          requestBudget: budget,
        });
        data.set(pairKey, [
          ...(data.get(pairKey) ?? []),
          { provider: provider.provider, results: sources },
        ]);
        successfulLanguages.set(
          provider.provider,
          new Set([...(successfulLanguages.get(provider.provider) ?? []), language]),
        );
      } catch {
        providerErrors.set(provider.provider, (providerErrors.get(provider.provider) ?? 0) + 1);
      } finally {
        const timing = responseTimes.get(provider.provider) ?? { totalMs: 0, operations: 0 };
        timing.totalMs += Date.now() - requestStartedAt;
        timing.operations += 1;
        responseTimes.set(provider.provider, timing);
      }
    });
  }

  const modes: Array<{ name: string; providers: SearchProviderId[] }> = [
    { name: "Exa", providers: ["exa"] },
    { name: "Tavily", providers: ["tavily"] },
    { name: "HasData", providers: ["hasdata"] },
    { name: "Exa + Tavily", providers: ["exa", "tavily"] },
    { name: "Exa + HasData", providers: ["exa", "hasdata"] },
    { name: "Tavily + HasData", providers: ["tavily", "hasdata"] },
    { name: "All", providers: ["exa", "tavily", "hasdata"] },
  ];
  const mergedByMode = new Map<string, SearchSource[]>();
  for (const mode of modes) {
    const allResults = pairList.flatMap(({ queryIndex, language }) => {
      const sets = (data.get(queryIndex + ":" + language) ?? []).filter((set) =>
        mode.providers.includes(set.provider),
      );
      return reciprocalRankFusion(sets);
    });
    mergedByMode.set(mode.name, allResults);
  }

  const fetchCandidates = new Map<string, SearchSource>();
  for (const sets of data.values()) {
    for (const set of sets) {
      for (const source of set.results.filter((item) => item.index <= 2)) {
        const url = normalizeOsintUrl(source.url);
        if (url) fetchCandidates.set(url, source);
      }
    }
  }
  const pageChecks = [...fetchCandidates.entries()].slice(0, pageCheckLimit);
  const fetchedText = new Map<string, string>();
  await concurrent(pageChecks, 5, async ([url, source]) => {
    if (source.text?.trim().length >= 800) {
      fetchedText.set(url, source.text);
      return;
    }
    try {
      const page = await fetchPublicPage(url, 8_000);
      if (page.fetched && page.text.trim().length >= 800) fetchedText.set(url, page.text);
    } catch {
      // Keep the source snippet fallback in memory only.
    }
  });

  const summaryProbeSources: Array<{ number: number; title: string; text: string }> = [];
  for (const queryIndex of runs.keys()) {
    if (summaryProbeSources.length >= 3) break;
    const queryResults = pairList
      .filter((pair) => pair.queryIndex === queryIndex)
      .flatMap(({ queryIndex: index, language }) =>
        reciprocalRankFusion(
          (data.get(index + ":" + language) ?? []).filter((set) =>
            ["exa", "tavily", "hasdata"].includes(set.provider),
          ),
        ),
      );
    for (const source of dedupeSearchSources(queryResults)) {
      const url = normalizeOsintUrl(source.url);
      const text =
        (url ? fetchedText.get(url) : undefined) ??
        source.text ??
        source.highlights?.join("\n") ??
        "";
      if (text.trim().length < 80 || !source.title.trim()) continue;
      summaryProbeSources.push({
        number: summaryProbeSources.length + 1,
        title: source.title.trim().slice(0, 300),
        text: text.trim().slice(0, 4_000),
      });
      break;
    }
  }

  let summaryProbeAttempts = 0;
  let summaryProbeValidCalls = 0;
  let summaryProbeDurationMs = 0;
  let summaryProbeSucceeded = false;
  let summaryProbeAzRows = 0;
  if (summaryProbeSources.length) {
    const accepted = new Set<number>();
    for (
      let languageRetry = 0;
      languageRetry < 2 && accepted.size < summaryProbeSources.length;
      languageRetry += 1
    ) {
      const pending = summaryProbeSources.filter((source) => !accepted.has(source.number));
      const beforeCall = Date.now();
      summaryProbeAttempts += 1;
      try {
        const result = await ai.light.generateObject(
          {
            system:
              languageRetry === 0
                ? "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script. Summarize each source independently."
                : "Return every summary and title only in natural Azerbaijani Latin script. Translate source-language prose; never copy source sentences. Keep entity names and quotes in original script.",
            prompt: JSON.stringify({ sources: pending }),
            temperature: 0.1,
            timeoutMs: 30_000,
            maxOutputTokens: 1_800,
            maxAttempts: 1,
            thinkingLevel: env.OSINT_THINKING_LEVEL,
            telemetryStep: "source_summary",
          },
          sourceSummaryBatchSchema,
        );
        for (const row of result.sources) {
          const source = pending.find((candidate) => candidate.number === row.number);
          if (
            source &&
            looksAzerbaijani(row.title) &&
            looksAzerbaijani(row.summary) &&
            row.claims.every(looksAzerbaijani)
          ) {
            accepted.add(row.number);
          }
        }
        if (pending.every((source) => accepted.has(source.number))) summaryProbeValidCalls += 1;
      } catch {
        // Evaluation output records only aggregate failure counts.
      } finally {
        summaryProbeDurationMs += Date.now() - beforeCall;
      }
    }
    summaryProbeAzRows = accepted.size;
    summaryProbeSucceeded = accepted.size === summaryProbeSources.length;
  }

  const metrics = modes.map((mode) => {
    const all = mergedByMode.get(mode.name) ?? [];
    const unique = dedupeSearchSources(all);
    const domains = new Set(
      unique.map(domainFor).filter((domain): domain is string => Boolean(domain)),
    );
    const coveredLanguages = new Set<OsintLanguage>();
    let referenceMatches = 0;
    const fullTextCandidates = new Set<string>();
    for (const { queryIndex, language } of pairList) {
      const sets = (data.get(queryIndex + ":" + language) ?? []).filter((set) =>
        mode.providers.includes(set.provider),
      );
      const pairResults = reciprocalRankFusion(sets);
      if (
        pairResults.length &&
        pairResults.some((source) =>
          matchesOsintLanguageScript(
            source.title + " " + (source.highlights?.join(" ") ?? ""),
            language,
          ),
        )
      ) {
        coveredLanguages.add(language);
      }
      for (const source of pairResults.filter((item) => item.index <= 2)) {
        const domain = domainFor(source);
        if (domain && seedDomains.get(queryIndex)?.has(domain)) referenceMatches++;
        const url = normalizeOsintUrl(source.url);
        if (url && fetchedText.has(url)) fullTextCandidates.add(url);
      }
    }
    const fullTextCount = [...fullTextCandidates].filter((url) => fetchedText.has(url)).length;
    return {
      mode: mode.name,
      providerSet: mode.providers,
      candidates: all.length,
      uniqueResults: unique.length,
      referenceDomainMatches: referenceMatches,
      languagesWithSources: [...coveredLanguages],
      uniqueDomains: domains.size,
      fullTextChecked: fullTextCandidates.size,
      fullTextRate: fullTextCandidates.size ? fullTextCount / fullTextCandidates.size : 0,
      duplicateRate: all.length ? (all.length - unique.length) / all.length : 0,
    };
  });

  const apiUsage = Object.fromEntries(
    providers.map((provider) => [
      provider.provider,
      {
        requests: provider.usageStats?.apiCalls ?? budgets.get(provider.provider)!.calls,
        budgetUsed: budgets.get(provider.provider)!.calls,
        budgetLimit: budgets.get(provider.provider)!.maxCalls,
        ...(provider.provider === "tavily"
          ? { credits: (provider as TavilyProvider).usageStats.credits }
          : {}),
        ...(provider.provider === "hasdata" ? { mode: env.HASDATA_MODE } : {}),
        errors: providerErrors.get(provider.provider) ?? 0,
        searchOperations: responseTimes.get(provider.provider)?.operations ?? 0,
        averageResponseMs: responseTimes.get(provider.provider)?.operations
          ? Math.round(
              responseTimes.get(provider.provider)!.totalMs /
                responseTimes.get(provider.provider)!.operations,
            )
          : null,
        languagesWithSuccessfulResponses: [...(successfulLanguages.get(provider.provider) ?? [])],
      },
    ]),
  );
  const output = {
    capturedAt: new Date().toISOString(),
    queriesRequested: requestedQueries,
    queriesEvaluated: runs.length,
    languages: OSINT_LANGUAGES,
    hasDataLanguageScope: hasDataLanguages,
    expansionCalls,
    expansionFailures,
    expansionDurationMs,
    summaryProbe: {
      selectedSources: summaryProbeSources.length,
      attempts: summaryProbeAttempts,
      successfulSteps: summaryProbeValidCalls,
      succeeded: summaryProbeSources.length ? summaryProbeSucceeded : null,
      AzerbaijaniSummaries: summaryProbeAzRows,
      AzerbaijaniShare: summaryProbeSources.length
        ? Number((summaryProbeAzRows / summaryProbeSources.length).toFixed(3))
        : null,
      durationMs: summaryProbeDurationMs,
    },
    queryLanguagePairs: pairList.length,
    providers: apiUsage,
    metrics,
    executionSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    pageFetches: pageChecks.length,
  };
  const totalSearchOperations = [...responseTimes.values()].reduce(
    (total, timing) => total + timing.operations,
    0,
  );
  const totalSearchErrors = [...providerErrors.values()].reduce((total, count) => total + count, 0);
  const llmStepAttempts = expansionCalls + expansionFailures + summaryProbeAttempts;
  const llmStepSuccesses = expansionCalls + summaryProbeValidCalls;
  const hasSuccessfulSearch = [...successfulLanguages.values()].some(
    (languages) => languages.size > 0,
  );
  const hybrid = metrics.find((metric) => metric.mode === "Exa + Tavily")!;
  console.log(JSON.stringify(output, null, 2));

  const outputPath = readArgument("output") ?? "docs/OSINT_EVAL_AFTER.md";
  const table = [
    "| Provider mode | Reference matches* | Languages | Unique domains | Full-text rate | Duplicate rate | Results | Avg. provider response |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    ...metrics.map((metric) => {
      const timings = metric.providerSet
        .map((provider) => responseTimes.get(provider))
        .filter((item): item is { totalMs: number; operations: number } =>
          Boolean(item && item.operations),
        );
      const avg = timings.length
        ? Math.round(
            timings.reduce((sum, item) => sum + item.totalMs / item.operations, 0) / timings.length,
          ) + " ms"
        : "—";
      return (
        "| " +
        metric.mode +
        " | " +
        (hasSuccessfulSearch ? metric.referenceDomainMatches : "n/a") +
        " | " +
        (hasSuccessfulSearch ? metric.languagesWithSources.join(", ") || "none" : "n/a") +
        " | " +
        (hasSuccessfulSearch ? metric.uniqueDomains : "n/a") +
        " | " +
        (hasSuccessfulSearch
          ? Math.round(metric.fullTextRate * 100) + "% (" + metric.fullTextChecked + " checked)"
          : "n/a") +
        " | " +
        (hasSuccessfulSearch ? Math.round(metric.duplicateRate * 100) + "%" : "n/a") +
        " | " +
        (hasSuccessfulSearch ? metric.uniqueResults : "n/a") +
        " | " +
        avg +
        " |"
      );
    }),
  ].join("\n");
  const comparisonTable = [
    "| Metric | Before | After (Exa + Tavily, offline RRF) |",
    "| --- | ---: | ---: |",
    "| Seed-domain relevance proxy | 12 | " +
      (hasSuccessfulSearch ? hybrid.referenceDomainMatches : "not measured (provider errors)") +
      " |",
    "| Languages with sources | 5 / 6 | " +
      (hasSuccessfulSearch
        ? hybrid.languagesWithSources.length + " / 8"
        : "not measured (no search responses)") +
      " |",
    "| Languages selected | 6 | 8 |",
    "| Unique domains | 47 | " +
      (hasSuccessfulSearch ? hybrid.uniqueDomains : "not measured (provider errors)") +
      " |",
    "| Full-text rate | 100% (36/36) | " +
      (hasSuccessfulSearch
        ? Math.round(hybrid.fullTextRate * 100) +
          "% (" +
          Math.round(hybrid.fullTextRate * hybrid.fullTextChecked) +
          "/" +
          hybrid.fullTextChecked +
          ")"
        : "not measured (no selected sources)") +
      " |",
    "| Duplicate rate | 39% | " +
      (hasSuccessfulSearch ? Math.round(hybrid.duplicateRate * 100) + "%" : "not measured") +
      " |",
    "| Selected summary sources | not recorded | " +
      (summaryProbeSources.length ? summaryProbeSources.length + " / 3" : "0 (no search results)") +
      " |",
    "| Azerbaijani summaries | not recorded | " +
      (output.summaryProbe.AzerbaijaniShare === null
        ? "not measurable (no selected sources)"
        : Math.round(output.summaryProbe.AzerbaijaniShare * 100) +
          "% (" +
          summaryProbeAzRows +
          "/" +
          summaryProbeSources.length +
          ")") +
      " |",
    "| Runtime | 18.5s | " + output.executionSeconds + "s |",
    "| Search requests | 18 | " +
      totalSearchOperations +
      " attempted (" +
      totalSearchErrors +
      " errors) |",
    "| Query expansion success | not recorded | " +
      expansionCalls +
      " / " +
      (expansionCalls + expansionFailures) +
      " |",
    "| LLM steps successful | not recorded | " + llmStepSuccesses + " / " + llmStepAttempts + " |",
  ].join("\n");
  const stepTable = [
    "| Step | Before | After |",
    "| --- | ---: | ---: |",
    "| Query expansion | not recorded | " + expansionDurationMs + " ms total |",
    "| Search providers | 18 requests; total step timing not recorded | Exa " +
      (apiUsage["exa"]?.averageResponseMs ?? "n/a") +
      " ms avg, Tavily " +
      (apiUsage["tavily"]?.averageResponseMs ?? "n/a") +
      " ms avg, HasData " +
      (apiUsage["hasdata"]?.averageResponseMs ?? "n/a") +
      " ms avg |",
    "| Azerbaijani summary probe | not recorded | " +
      (summaryProbeSources.length
        ? summaryProbeDurationMs + " ms for " + summaryProbeSources.length + " selected sources"
        : "not run (no selected sources)") +
      " |",
  ].join("\n");
  const report = [
    "# OSINT provider evaluation",
    "",
    "Captured: " + output.capturedAt,
    "",
    "The same " +
      runs.length +
      " seed queries were submitted for search across the eight required languages. HasData was limited to " +
      hasDataLanguages.join(", ") +
      ". Provider combinations below are merged offline with RRF (k=60); no extra API calls are made for combined modes.",
    "",
    "*Reference matches count matching domains from the seed fixture. This is a comparison proxy, not blind relevance scoring or a source-quality judgment.",
    "",
    "Evaluation status: " +
      (hasSuccessfulSearch
        ? "search responses received"
        : "incomplete; no provider returned a search response") +
      ". Query texts, page text, prompts and model outputs are not stored in this report.",
    "",
    hasSuccessfulSearch
      ? "Average provider timings below represent successful search responses."
      : "Provider timings below are failed request durations, not successful response times.",
    "",
    table,
    "",
    "## Baseline comparison",
    "",
    "The post-change hybrid row is computed from both providers' three-query results merged offline with RRF; it is a comparison ceiling for the conditional production fallback, not an exact replay of that fallback policy. The baseline used six languages and five were observed; the new run uses all eight.",
    "",
    comparisonTable,
    "",
    "## Step timings",
    "",
    stepTable,
    "",
    "Full-text checks used the existing SSRF-safe page fetcher, capped at 24 distinct pages. A page counts only at 800 or more extracted characters.",
    "",
    "## API usage",
    "",
    "Provider usage JSON: " + JSON.stringify(apiUsage),
    "",
    "Query expansion calls: " +
      expansionCalls +
      " (failures: " +
      expansionFailures +
      "). Total elapsed: " +
      output.executionSeconds +
      "s. Secure page fetches: " +
      output.pageFetches +
      ".",
    "",
  ].join("\n");
  await writeFile(outputPath, report, "utf8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "OSINT evaluation failed.");
  process.exitCode = 1;
});
