import { readFile, writeFile } from "node:fs/promises";

import { ExaProvider, SearchRequestBudget } from "../src/server/ai/exa";
import { HasDataProvider } from "../src/server/ai/hasdata";
import { TavilyProvider } from "../src/server/ai/tavily";
import type { SearchProvider, SearchProviderId, SearchSource } from "../src/server/ai/types";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { readServerEnv } from "../src/server/env";
import { z } from "zod";
import {
  OSINT_LANGUAGES,
  osintLanguageLocale,
  osintLanguageNames,
  type OsintLanguage,
  type OsintPeriod,
} from "../src/lib/osint";
import { fetchPublicPage } from "../src/server/osint/fetch-public-page";
import { dedupeSearchSources, reciprocalRankFusion } from "../src/server/osint/ranking";
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
const pageCheckLimit = 80;
const hasDataLanguages: OsintLanguage[] = ["fa", "hy", "ka", "zh"];
const translationSchema = z
  .object({
    fa: z.string().trim().min(2).max(500),
    hy: z.string().trim().min(2).max(500),
    ru: z.string().trim().min(2).max(500),
    zh: z.string().trim().min(2).max(500),
    en: z.string().trim().min(2).max(500),
    fr: z.string().trim().min(2).max(500),
    ka: z.string().trim().min(2).max(500),
  })
  .strict();

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
  let translationCalls = 0;
  let translationFailures = 0;

  for (const [queryIndex, run] of runs.entries()) {
    seedDomains.set(queryIndex, new Set(run.sources.map((source) => source.domain.toLowerCase())));
    let translations: Record<OsintLanguage, string>;
    try {
      translations = await ai.osint.generateObject(
        {
          temperature: 0,
          timeoutMs: 12_000,
          maxAttempts: 1,
          prompt: [
            "Translate the research query naturally for web search into each requested language. Keep people, places and dates. Return one strict JSON object with the language codes as keys and one concise search query per value. Do not answer the query.",
            JSON.stringify({
              query: run.query,
              languages: OSINT_LANGUAGES.map((language) => ({
                code: language,
                name: osintLanguageNames[language],
              })),
            }),
          ].join("\n\n"),
        },
        translationSchema,
      );
      translationCalls += 1;
    } catch {
      translationFailures += 1;
      translations = Object.fromEntries(
        OSINT_LANGUAGES.map((language) => [language, run.query]),
      ) as Record<OsintLanguage, string>;
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
  const fetchedText = new Map<string, boolean>();
  await concurrent(pageChecks, 5, async ([url, source]) => {
    if (source.text?.trim().length >= 800) {
      fetchedText.set(url, true);
      return;
    }
    try {
      const page = await fetchPublicPage(url, 8_000);
      fetchedText.set(url, page.fetched && page.text.trim().length >= 800);
    } catch {
      fetchedText.set(url, false);
    }
  });

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
    const fullTextCount = [...fullTextCandidates].filter(
      (url) => fetchedText.get(url) === true,
    ).length;
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
    translationCalls,
    translationFailures,
    queryLanguagePairs: pairList.length,
    providers: apiUsage,
    metrics,
    executionSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    pageFetches: pageChecks.length,
  };
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
        metric.referenceDomainMatches +
        " | " +
        (metric.languagesWithSources.join(", ") || "none") +
        " | " +
        metric.uniqueDomains +
        " | " +
        Math.round(metric.fullTextRate * 100) +
        "% (" +
        metric.fullTextChecked +
        " checked) | " +
        Math.round(metric.duplicateRate * 100) +
        "% | " +
        metric.uniqueResults +
        " | " +
        avg +
        " |"
      );
    }),
  ].join("\n");
  const hybrid = metrics.find((metric) => metric.mode === "Exa + Tavily")!;
  const comparisonTable = [
    "| Metric | Before | After (Exa + Tavily, offline RRF) |",
    "| --- | ---: | ---: |",
    "| Seed-domain relevance proxy | 12 | " + hybrid.referenceDomainMatches + " |",
    "| Languages with sources | 5 / 6 | " + hybrid.languagesWithSources.length + " / 7 |",
    "| Unique domains | 47 | " + hybrid.uniqueDomains + " |",
    "| Full-text rate | 100% (36/36) | " +
      Math.round(hybrid.fullTextRate * 100) +
      "% (" +
      Math.round(hybrid.fullTextRate * hybrid.fullTextChecked) +
      "/" +
      hybrid.fullTextChecked +
      ") |",
    "| Duplicate rate | 39% | " + Math.round(hybrid.duplicateRate * 100) + "% |",
    "| Runtime | 18.5s | " + output.executionSeconds + "s |",
    "| Search requests | 18 | " +
      (apiUsage["exa"]?.requests ?? 0) +
      " Exa + " +
      (apiUsage["tavily"]?.requests ?? 0) +
      " Tavily |",
    "| LLM calls | 3 | " + translationCalls + " |",
  ].join("\n");
  const report = [
    "# OSINT provider evaluation",
    "",
    "Captured: " + output.capturedAt,
    "",
    "The same " +
      runs.length +
      " seed queries were searched across the seven required languages. HasData was limited to " +
      hasDataLanguages.join(", ") +
      ". Provider combinations below are merged offline with RRF (k=60); no extra API calls are made for combined modes.",
    "",
    "*Reference matches count matching domains from the seed fixture. This is a comparison proxy, not blind relevance scoring or a source-quality judgment.",
    "",
    table,
    "",
    "## Baseline comparison",
    "",
    "The post-change hybrid row is computed from both providers' three-query results merged offline with RRF; it is a comparison ceiling for the conditional production fallback, not an exact replay of that fallback policy. The baseline used six languages and five were observed; the new run uses all seven.",
    "",
    comparisonTable,
    "",
    "Full-text checks used the existing SSRF-safe page fetcher, capped at two top-ranked results per query-language-provider and 80 distinct pages. A page counts only at 800 or more extracted characters.",
    "",
    "## API usage",
    "",
    "Provider usage JSON: " + JSON.stringify(apiUsage),
    "",
    "Query translation calls: " +
      translationCalls +
      " (failures: " +
      translationFailures +
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
