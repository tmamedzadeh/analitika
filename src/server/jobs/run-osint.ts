import { and, eq, inArray } from "drizzle-orm";
import {
  ExaProvider,
  ExaRequestError,
  SearchRequestBudget,
  SearchRequestBudgetExceededError,
} from "../ai/exa";
import { createGeminiProviders } from "../ai/gemini";
import { GeminiGroundingProvider } from "../ai/gemini-search";
import { TavilyProvider, TavilyRequestError } from "../ai/tavily";
import { searchWithFallback } from "../ai/provider-fallback";
import type { LLMProvider, SearchProvider, SearchProviderId, SearchSource } from "../ai/types";
import type { RequestCallBudget } from "../ai/types";
import { getAppConfig } from "../config";
import { readServerEnv } from "../env";
import { getDb } from "../db";
import { osintCache, osintRuns, osintSources } from "../db/schema";
import {
  OSINT_LANGUAGES,
  osintLanguageLocale,
  type OsintLanguage,
  type OsintPeriod,
} from "@/lib/osint";
import { az } from "@/lib/i18n/az";
import { cachePublicPageText, fetchCachedPublicPage } from "../osint/page-cache";
import { shouldReadOsintSearchCache } from "../osint/cache";
import { readOsintSearchCache, writeOsintSearchCache } from "../osint/search-cache";
import {
  getPeriodStart,
  isWithinOsintPeriod,
  matchesOsintLanguageScript,
  normalizeOsintUrl,
} from "../osint/urls";
import {
  cachedQueryExpansions,
  generateQueryExpansionsWithFallback,
  QUERY_EXPANSION_FALLBACK_BUDGET_MS,
  QUERY_EXPANSION_HTTP_TIMEOUT_MS,
  QUERY_EXPANSION_PRIMARY_BUDGET_MS,
  queryExpansionMainSchema,
  queryExpansionsSchema,
  type QueryExpansion,
} from "../osint/query-expansion";
import { registryDomains } from "../osint/source-registry";
import {
  classifyDomains,
  classifyWithModel,
  knownDomainClassification,
  resolveSourceOrigin,
  type DomainClassification,
  type DomainType,
  type OriginResolution,
} from "../osint/domain-classification";
import { createDbClassificationStore } from "../osint/domain-classification-store";
import { resolveFinalUrl } from "../osint/fetch-public-page";
import {
  assignSemanticRelevance,
  dedupeSearchSources,
  reciprocalRankFusion,
  selectWithMmr,
  type RankedCandidate,
} from "../osint/ranking";
import {
  keepExplicitTimelineDates,
  reportSummaryText,
  type SummaryOutputFailure,
  type SummaryStatus,
  type SourceSummary,
  type StoredStructuredReport,
} from "../osint/reports";
import type { OsintDiagnosticsProgress } from "../osint/diagnostics";
import { synthesizeReport } from "../osint/report-synthesis";
import { skippedSummaryOutcome, summarizeSources } from "../osint/summary-generation";

const MAX_RUNTIME_MS = 120_000;
type FetchStatus =
  | "provider_text"
  | "fetched_full"
  | "snippet_fallback"
  | "robots_denied"
  | "dns_or_network_error"
  | "http_error"
  | "non_html"
  | "timeout"
  | "invalid_url";
type SourceType = DomainType;
type Progress = {
  percent: number;
  completedLanguages: number;
  totalLanguages: number;
  sourcesFound: number;
  sourcesProcessed: number;
  fetchStatusCounts: Record<FetchStatus, number>;
  failedSteps: string[];
  currentLanguage?: string;
  partial?: boolean;
  notice?: string;
  fallbackProvider?: boolean;
  fallbackReason?: string;
  expansionFallbackLanguages?: OsintLanguage[];
  summaryStatusCounts?: Partial<Record<SummaryStatus, number>>;
  summaryFailureReasons?: Partial<Record<SummaryOutputFailure, number>>;
  reportNotes?: string[];
  diagnostics?: OsintDiagnosticsProgress;
};
type Candidate = {
  url: string;
  title: string;
  domain: string;
  language: OsintLanguage;
  searchText: string;
  pageText: string;
  fetched: boolean;
  fetchStatus: FetchStatus;
  publishedAt?: Date;
  sourceId?: string;
  number: number;
  summary: string | null;
  structuredSummary?: SourceSummary;
  providers: SearchProviderId[];
  providerRank: number;
  sourceType: SourceType;
  affiliation?: string;
  semanticRelevance: number;
  summaryStatus?: SummaryStatus;
};
const fetchStatuses: FetchStatus[] = [
  "provider_text",
  "fetched_full",
  "snippet_fallback",
  "robots_denied",
  "dns_or_network_error",
  "http_error",
  "non_html",
  "timeout",
  "invalid_url",
];

export function hasProviderPageText(source: SearchSource): boolean {
  return typeof source.text === "string" && source.text.trim().length >= 800;
}
export function chooseSourceText(
  providerText: string | undefined,
  fetchedText: string | undefined,
  snippet: string,
): { text: string; status: "provider_text" | "fetched_full" | "snippet_fallback" } {
  if (providerText?.trim().length && providerText.trim().length >= 800)
    return { text: providerText.trim(), status: "provider_text" };
  if (fetchedText?.trim().length && fetchedText.trim().length >= 800)
    return { text: fetchedText.trim(), status: "fetched_full" };
  return { text: snippet.trim(), status: "snippet_fallback" };
}
const remaining = (start: number) => Math.max(0, MAX_RUNTIME_MS - (Date.now() - start));
const signalFor = (global: AbortSignal, start: number, max: number) =>
  AbortSignal.any([global, AbortSignal.timeout(Math.max(1, Math.min(max, remaining(start))))]);
async function concurrent<T, U>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= values.length) return;
        output[i] = await fn(values[i]!, i);
      }
    }),
  );
  return output;
}
export function inferUnregisteredSourceType(hostname: string): SourceType {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)(gov|mil)(\.[a-z]{2,})?$/.test(host) || /(^|\.)(gov|mil)\./.test(host))
    return "official";
  if (
    /(think.?tank|institute|policy|research|foundation|centre|center|strategic|analysis)/i.test(
      host,
    )
  )
    return "think_tank";
  if (/(news.?agency|agency|presswire|wire|interfax)/i.test(host)) return "agency";
  if (/(public.?radio|public.?tv|broadcaster|broadcast)/i.test(host)) return "public_broadcaster";
  if (
    /(news|media|press|journal|times|post|daily|gazette|newspaper)/i.test(host) ||
    /\.news$/.test(host)
  )
    return "media";
  return "other";
}

export function statusFor(
  domain: string,
  language: OsintLanguage,
  classified: ReadonlyMap<string, DomainClassification> = new Map(),
): { type: SourceType; affiliation?: string } {
  const host = domain.toLowerCase().replace(/^www./, "");
  const known = knownDomainClassification(host, language) ?? knownDomainClassification(host);
  if (known) {
    return { type: known.type, ...(known.affiliation ? { affiliation: known.affiliation } : {}) };
  }
  const stored = classified.get(host);
  if (stored && stored.type !== "other") {
    return {
      type: stored.type,
      affiliation:
        stored.source === "manual" ? "manual classification" : "model-based classification",
    };
  }
  const type = inferUnregisteredSourceType(host);
  return type === "other" ? { type } : { type, affiliation: "domain-based classification" };
}

function originAffiliation(origin: OriginResolution): string | undefined {
  if (!origin.via) return undefined;
  return origin.via === "archive"
    ? "archived copy; original source " + origin.domain
    : "resolved link; original source " + origin.domain;
}
function published(value?: string): Date | undefined {
  if (!value) return;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export type OsintSearchTask = {
  language: OsintLanguage;
  query: string;
  domains?: string[];
};

export function planOsintSearchPhases(
  languages: readonly OsintLanguage[],
  expansions: Record<OsintLanguage, QueryExpansion>,
  resultsPerLanguage: ReadonlyMap<OsintLanguage, number>,
): { main: OsintSearchTask[]; registry: OsintSearchTask[]; variants: OsintSearchTask[] } {
  return {
    main: languages.map((language) => ({ language, query: expansions[language].main })),
    registry: languages
      .filter((language) => (resultsPerLanguage.get(language) ?? 0) < 10)
      .map((language) => ({
        language,
        query: expansions[language].main,
        domains: registryDomains(language),
      })),
    variants: languages.flatMap((language) =>
      expansions[language].variants.map((query) => ({ language, query })),
    ),
  };
}

export async function executeOsintSearchPhases(
  runMain: () => Promise<void>,
  getRegistry: () => OsintSearchTask[],
  variants: OsintSearchTask[],
  canSpendMore: () => boolean,
  runPhase: (name: "main" | "registry" | "variants", tasks: OsintSearchTask[]) => Promise<void>,
): Promise<void> {
  await runMain();
  const registry = getRegistry();
  if (registry.length && canSpendMore()) await runPhase("registry", registry);
  if (variants.length && canSpendMore()) await runPhase("variants", variants);
}

export function partitionSearchRequestBudget(
  parent: SearchRequestBudget,
  taskCount: number,
): RequestCallBudget[] {
  const remainingCalls = Math.max(0, parent.maxCalls - parent.calls);
  const perTaskLimit = Math.max(1, Math.floor(remainingCalls / Math.max(1, taskCount)));
  return Array.from({ length: taskCount }, () => {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      reserve() {
        if (calls >= perTaskLimit) throw new SearchRequestBudgetExceededError();
        parent.reserve();
        calls += 1;
      },
    };
  });
}

export function osintFailureCategory(error: unknown): string {
  if (error instanceof SearchRequestBudgetExceededError) return "search_budget";
  const status =
    error && typeof error === "object"
      ? Number(
          (error as Record<string, unknown>)["statusCode"] ??
            (error as Record<string, unknown>)["status"] ??
            0,
        )
      : 0;
  if (status === 429) return "rate_limit";
  if (error instanceof Error && /timeout|abort/i.test(error.name + " " + error.message))
    return "timeout";
  if (error instanceof Error && /language/i.test(error.message)) return "language";
  if (
    error instanceof Error &&
    /schema|invalid structured report|BLUF is missing/i.test(error.message)
  )
    return "schema";
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && /json|summary|translation/i.test(error.message))
  ) {
    return "invalid_json";
  }
  if (error instanceof Error && /budget/i.test(error.message)) return "search_budget";
  return "other";
}
async function makeProviders(): Promise<{
  llm: LLMProvider;
  light: LLMProvider;
  embeddings: ReturnType<typeof createGeminiProviders>["embeddings"];
  search: SearchProvider;
  fallback?: SearchProvider;
}> {
  const env = readServerEnv(),
    ai = createGeminiProviders();
  return {
    llm: ai.osint,
    light: ai.light,
    embeddings: ai.embeddings,
    search:
      getAppConfig().searchProvider === "gemini_grounding"
        ? new GeminiGroundingProvider(ai.osint)
        : new ExaProvider(env.EXA_API_KEY),
    ...(getAppConfig().searchProvider === "exa" && env.TAVILY_API_KEY
      ? { fallback: new TavilyProvider(env.TAVILY_API_KEY) }
      : {}),
  };
}
function emptyFetchCounts(): Record<FetchStatus, number> {
  return Object.fromEntries(fetchStatuses.map((s) => [s, 0])) as Record<FetchStatus, number>;
}

function cacheTtl(period: OsintPeriod): number {
  if (period === "24h") return 3 * 60 * 60_000;
  if (period === "7d") return 12 * 60 * 60_000;
  return 72 * 60 * 60_000;
}

export function compactFallbackReason(error: unknown): string {
  const status =
    error instanceof TavilyRequestError || error instanceof ExaRequestError
      ? error.statusCode
      : error && typeof error === "object"
        ? Number(
            (error as Record<string, unknown>)["statusCode"] ??
              (error as Record<string, unknown>)["status"] ??
              0,
          )
        : 0;
  if (status === 429) return "rate_limit";
  if (error instanceof Error && /timeout|abort/i.test(error.name + " " + error.message))
    return "timeout";
  if (status > 0) return `http_${status}`;
  return "other";
}

export async function runOsintJob(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(osintRuns).where(eq(osintRuns.id, runId)).limit(1);
  if (!run || run.status === "done" || run.status === "partial" || run.status === "failed") return;
  if (run.status === "running" && Date.now() - run.createdAt.getTime() < 300_000) return;

  const languages = OSINT_LANGUAGES.filter((language) => run.languages.includes(language));
  const period = run.period as OsintPeriod;
  const start = Date.now();
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(new Error("deadline")), MAX_RUNTIME_MS);
  const env = readServerEnv();
  const searchBudget = new SearchRequestBudget(env.OSINT_MAX_SEARCH_REQUESTS);
  let providers: Awaited<ReturnType<typeof makeProviders>> | undefined;
  let partial = false;
  let step = "queued";
  let queue = Promise.resolve();
  const progress: Progress = {
    percent: 0,
    completedLanguages: 0,
    totalLanguages: languages.length,
    sourcesFound: 0,
    sourcesProcessed: 0,
    fetchStatusCounts: emptyFetchCounts(),
    failedSteps: [],
  };
  const providerUsage = new Map<
    SearchProviderId,
    { calls: number; results: number; started: number }
  >();
  const stageMs: Record<string, number> = {};
  const llmAttempts = { summary: 0, report: 0 };
  let stageStartedAt = Date.now();
  let sourcesSelected = 0;
  let cacheErrors = 0;
  const closeStage = (next: string) => {
    if (next === step) return;
    const now = Date.now();
    if (step !== "queued") stageMs[step] = (stageMs[step] ?? 0) + (now - stageStartedAt);
    stageStartedAt = now;
  };
  const diagnostics = (): OsintDiagnosticsProgress => ({
    stageMs: { ...stageMs },
    searchQueries: searchBudget.calls,
    providers: [...providerUsage.keys()],
    sourcesSelected,
    llmAttempts: { ...llmAttempts },
    cacheErrors,
  });
  const save = (next: string, patch: Partial<Progress> = {}) => {
    closeStage(next);
    step = next;
    Object.assign(progress, patch);
    const snapshot = {
      ...progress,
      fetchStatusCounts: { ...progress.fetchStatusCounts },
      failedSteps: [...progress.failedSteps],
      diagnostics: diagnostics(),
    };
    queue = queue.then(async () => {
      const updated = await db
        .update(osintRuns)
        .set({ status: "running", step: next, progress: snapshot, heartbeatAt: new Date() })
        .where(and(eq(osintRuns.id, runId), inArray(osintRuns.status, ["queued", "running"])))
        .returning({ id: osintRuns.id });
      if (!updated.length) throw new Error("OSINT run is already closed.");
    });
    return queue;
  };
  const fail = (name: string, error?: unknown) => {
    const category = error ? osintFailureCategory(error) : "";
    const label = category ? name + ":" + category : name;
    if (!progress.failedSteps.includes(label)) progress.failedSteps.push(label);
    partial = true;
  };

  try {
    if (!languages.length) throw new Error("No OSINT languages.");
    await db.delete(osintSources).where(eq(osintSources.runId, runId));
    providers = await makeProviders();
    let expansions: Record<OsintLanguage, QueryExpansion>;
    await save("translating", { percent: 4 });
    try {
      const primaryDeadline = AbortSignal.timeout(
        Math.max(1, Math.min(QUERY_EXPANSION_PRIMARY_BUDGET_MS, remaining(start))),
      );
      const expansionSignal = AbortSignal.any([aborter.signal, primaryDeadline]);
      expansions = await cachedQueryExpansions(
        run.query,
        languages,
        getAppConfig().osintModel,
        async () => {
          const expansionRun = await generateQueryExpansionsWithFallback(
            run.query,
            languages,
            async () => {
              const input = {
                temperature: 0.1,
                timeoutMs: QUERY_EXPANSION_HTTP_TIMEOUT_MS,
                signal: expansionSignal,
                thinkingLevel: env.OSINT_THINKING_LEVEL,
                maxOutputTokens: 500,
                maxAttempts: 2 as const,
                telemetryStep: "expansion" as const,
                system:
                  "Create a main search query and up to two distinct useful variants for every requested language. For az, main must exactly equal the original query without translation; variants should be Azerbaijani synonyms or alternate phrasings. Keep names, dates, and entities unchanged.",
                prompt: JSON.stringify({ query: run.query, languages }),
              };
              if (providers!.llm.generateObjectPrimary) {
                return providers!.llm.generateObjectPrimary(
                  input,
                  queryExpansionsSchema(languages),
                );
              }
              if (!providers!.llm.generateObject)
                throw new Error("Structured output is unavailable.");
              return providers!.llm.generateObject(input, queryExpansionsSchema(languages));
            },
            async (fallbackLanguages) => {
              progress.expansionFallbackLanguages = [...fallbackLanguages];
              const fallbackDeadline = AbortSignal.timeout(
                Math.max(1, Math.min(QUERY_EXPANSION_FALLBACK_BUDGET_MS, remaining(start))),
              );
              const fallbackSignal = AbortSignal.any([aborter.signal, fallbackDeadline]);
              const config = getAppConfig();
              if (!config.lightModel || config.lightModel === config.osintModel) {
                throw new Error("A distinct AI_LIGHT_MODEL is unavailable.");
              }
              if (!providers!.light.generateObject)
                throw new Error("Fallback structured output is unavailable.");
              return providers!.light.generateObject(
                {
                  temperature: 0,
                  timeoutMs: QUERY_EXPANSION_HTTP_TIMEOUT_MS,
                  signal: fallbackSignal,
                  thinkingLevel: "low",
                  maxOutputTokens: 300,
                  maxAttempts: 1,
                  telemetryStep: "expansion",
                  system:
                    "Translate the search query once into each requested language. Return only the main query strings. Keep names, dates, and entities unchanged.",
                  prompt: JSON.stringify({ query: run.query, languages: fallbackLanguages }),
                },
                queryExpansionMainSchema(fallbackLanguages),
              );
            },
          );
          progress.expansionFallbackLanguages = [...expansionRun.fallbackLanguages];
          if (expansionRun.fallbackFailed) {
            fail("expansion_fallback", expansionRun.error);
            throw expansionRun.error ?? new Error("Query expansion fallback failed.");
          }
          return expansionRun.expansions;
        },
        {
          cacheable: () => !progress.expansionFallbackLanguages?.length,
          onCacheError: () => {
            cacheErrors += 1;
          },
        },
      );
    } catch (error) {
      if (!progress.failedSteps.includes("expansion_fallback")) fail("expansion", error);
      expansions = Object.fromEntries(
        languages.map((language) => [language, { main: run.query, variants: [] }]),
      ) as unknown as Record<OsintLanguage, QueryExpansion>;
    }

    const searchSets = new Map(
      languages.map((language) => [
        language,
        [] as Array<{ provider: SearchProviderId; results: SearchSource[] }>,
      ]),
    );
    const runSearch = async (
      language: OsintLanguage,
      query: string,
      includeDomains?: string[],
      taskBudget: RequestCallBudget = searchBudget,
    ) => {
      if (searchBudget.calls >= searchBudget.maxCalls || remaining(start) < 500) return;
      const since = getPeriodStart(period);
      const input = {
        query,
        language,
        country: osintLanguageLocale[language].country,
        userLocation: osintLanguageLocale[language].country,
        limit: includeDomains?.length ? 5 : 10,
        numResults: includeDomains?.length ? 5 : 10,
        ...(includeDomains?.length ? { includeDomains } : {}),
        ...(since ? { startPublishedDate: since, endPublishedDate: new Date().toISOString() } : {}),
        timeoutMs: Math.min(15_000, remaining(start)),
        signal: signalFor(aborter.signal, start, 15_000),
        requestBudget: taskBudget,
        thinkingLevel: env.OSINT_THINKING_LEVEL,
        maxOutputTokens: 500,
        telemetryStep: "search",
      };
      const primaryProvider = providers!.search;
      const fallbackProvider = providers!.fallback;
      let fallbackAttempted = false;
      const call = async (provider: SearchProvider): Promise<SearchSource[]> => {
        const began = Date.now();
        try {
          const cacheInput = {
            provider: provider.provider,
            language,
            query,
            period,
            ...(includeDomains?.length ? { includeDomains } : {}),
          };
          const cached = shouldReadOsintSearchCache(run.cacheBypass)
            ? await readOsintSearchCache(cacheInput)
            : null;
          const results = cached ?? (await provider.search(input));
          const usage = providerUsage.get(provider.provider) ?? {
            calls: 0,
            results: 0,
            started: began,
          };
          if (!cached) usage.calls = provider.usageStats?.apiCalls ?? usage.calls + 1;
          usage.results += results.length;
          providerUsage.set(provider.provider, usage);
          searchSets.get(language)!.push({ provider: provider.provider, results });
          if (!cached) await writeOsintSearchCache(cacheInput, results);
          return results;
        } catch (error) {
          const usage = providerUsage.get(provider.provider) ?? {
            calls: 0,
            results: 0,
            started: began,
          };
          usage.calls = provider.usageStats?.apiCalls ?? usage.calls + 1;
          providerUsage.set(provider.provider, usage);
          throw error;
        }
      };
      try {
        const result = await searchWithFallback(
          primaryProvider,
          fallbackProvider,
          call,
          (reason) => {
            fallbackAttempted = true;
            progress.fallbackProvider = true;
            progress.fallbackReason = reason;
            console.info("[OSINT] fallback=exa→tavily reason=" + reason);
          },
        );
        if (result.fallbackReason) progress.notice = az.osint.fallbackUsed;
      } catch (error) {
        if (fallbackAttempted) progress.notice = az.osint.providersUnavailable;
        fail("searching:" + language + ":" + compactFallbackReason(error));
      }
    };
    const runPhase = async (tasks: OsintSearchTask[], percent: number) => {
      const taskBudgets = partitionSearchRequestBudget(searchBudget, tasks.length);
      await concurrent(tasks, 4, (task, index) =>
        runSearch(task.language, task.query, task.domains, taskBudgets[index]!),
      );
      await save("searching", {
        percent,
        completedLanguages: languages.length,
      });
    };

    // Keep the requested degradation order: all main queries, registry coverage, then variants.
    await save("searching", { percent: 12 });
    const phases = planOsintSearchPhases(languages, expansions, new Map());
    await executeOsintSearchPhases(
      () => runPhase(phases.main, 18),
      () => {
        const registryCounts = new Map(
          languages.map((language) => [
            language,
            reciprocalRankFusion(searchSets.get(language) ?? []).length,
          ]),
        );
        return planOsintSearchPhases(languages, expansions, registryCounts).registry;
      },
      phases.variants,
      () => searchBudget.calls < searchBudget.maxCalls,
      async (name, tasks) => runPhase(tasks, name === "main" ? 18 : name === "registry" ? 24 : 30),
    );

    const rawCandidates: RankedCandidate[] = [];
    for (const language of languages) {
      const merged = reciprocalRankFusion(searchSets.get(language) ?? []).slice(0, 10);
      for (const source of dedupeSearchSources(merged)) {
        const url = normalizeOsintUrl(source.url);
        if (!url) continue;
        const domain = new URL(url).hostname;
        const title = source.title.trim() || domain;
        const text =
          source.text?.trim() ?? source.highlights?.join(" ").trim() ?? source.searchSummary ?? "";
        const date = published(source.publishedAt ?? source.publishedDate);
        if (date && !isWithinOsintPeriod(date, period)) continue;
        if (!matchesOsintLanguageScript(title + "\n" + text, language)) continue;
        rawCandidates.push({
          ...source,
          url,
          title,
          domain,
          language,
          text: text.slice(0, 1_200),
          semanticRelevance: 0,
          relevanceQuery: expansions[language]!.main,
          providerFullText: hasProviderPageText(source),
        });
      }
    }

    await save("selecting", { percent: 31 });
    let ranked = dedupeSearchSources(rawCandidates);
    if (ranked.length) {
      try {
        const queryVectors = await providers.embeddings.embedQueries(
          languages.map((language) => expansions[language]!.main),
        );
        const candidateVectors = await providers.embeddings.embedDocuments(
          ranked.map((candidate) => candidate.title + "\n" + candidate.text.slice(0, 600)),
        );
        const languageIndex = new Map(languages.map((language, index) => [language, index]));
        ranked = ranked.map((candidate, index) => {
          const queryVector = queryVectors[languageIndex.get(candidate.language)!];
          const vector = candidateVectors[index];
          return queryVector && vector ? { ...candidate, queryVector, vector } : candidate;
        });
      } catch (error) {
        fail("embedding", error);
      }
    }
    ranked = assignSemanticRelevance(run.query, ranked);
    const mmrSelected = selectWithMmr(ranked, {
      lambda: env.OSINT_MMR_LAMBDA,
      threshold: env.OSINT_RELEVANCE_THRESHOLD,
      maxPerDomain: 5,
      maxSelected: 35,
    });
    sourcesSelected = mmrSelected.length;

    // Archive copies and DOI links are traced to their original domain; a copy whose original is
    // already selected is dropped so the same publication is not counted as two independent sources.
    const resolvedOrigins = await concurrent(mmrSelected, 5, (result) =>
      remaining(start) > 5_000
        ? resolveSourceOrigin(result.url, (url) =>
            resolveFinalUrl(url, Math.min(4_000, remaining(start))),
          )
        : Promise.resolve<OriginResolution>({ url: result.url, domain: result.domain }),
    );
    const selectedUrls = new Set(mmrSelected.map((result) => result.url));
    const selected: typeof mmrSelected = [];
    const originByUrl = new Map<string, OriginResolution>();
    for (const [index, result] of mmrSelected.entries()) {
      const origin = resolvedOrigins[index]!;
      const originalUrl = origin.originalUrl ? normalizeOsintUrl(origin.originalUrl) : null;
      if (originalUrl && originalUrl !== result.url && selectedUrls.has(originalUrl)) continue;
      originByUrl.set(result.url, origin);
      selected.push(result);
    }

    let domainClassifications = new Map<string, DomainClassification>();
    if (selected.length && remaining(start) > 10_000) {
      const outcome = await classifyDomains(
        selected.map((result) => originByUrl.get(result.url)!.domain),
        {
          store: createDbClassificationStore(),
          classify: (domains) => classifyWithModel(domains, providers!.light, aborter.signal),
        },
      );
      domainClassifications = outcome.classifications;
    }
    await save("fetching", { percent: 34, sourcesFound: selected.length });

    const loaded = await concurrent(
      selected,
      5,
      async (result, index): Promise<Candidate | null> => {
        const origin = originByUrl.get(result.url) ?? { url: result.url, domain: result.domain };
        const classification = statusFor(origin.domain, result.language, domainClassifications);
        const affiliation = originAffiliation(origin) ?? classification.affiliation;
        let title = result.title;
        let publishedAt = published(result.publishedAt ?? result.publishedDate);
        const providerText = result.providerFullText ? result.text.trim() : "";
        let text = providerText.length >= 800 ? providerText.slice(0, 12_000) : "";
        let fetchStatus: FetchStatus = text ? "provider_text" : "snippet_fallback";
        if (text) {
          await cachePublicPageText({
            url: result.url,
            language: result.language,
            text,
            title: result.title,
            publishedAt: published(result.publishedAt ?? result.publishedDate) ?? null,
          });
        }
        if (!text && remaining(start) > 250) {
          try {
            const page = await fetchCachedPublicPage(
              result.url,
              result.language,
              Math.min(8_000, remaining(start)),
            );
            fetchStatus = page.fetchStatus;
            if (page.fetched && page.text.trim().length >= 800) {
              text = page.text.trim().slice(0, 12_000);
              fetchStatus = "fetched_full";
            } else if (page.fetched) {
              fetchStatus = "snippet_fallback";
            }
            title = page.title?.trim() || title;
            if (!publishedAt && page.publishedAt) publishedAt = page.publishedAt;
          } catch {
            fetchStatus = "dns_or_network_error";
          }
        }
        const snippet = (text || result.text || result.title).slice(0, 1_200);
        if (publishedAt && !isWithinOsintPeriod(publishedAt, period)) return null;
        const candidate: Candidate = {
          url: result.url,
          title,
          domain: origin.domain,
          language: result.language,
          searchText: snippet,
          pageText: text || snippet,
          fetched: Boolean(text),
          fetchStatus,
          ...(publishedAt ? { publishedAt } : {}),
          number: index + 1,
          summary: null,
          providers: result.providers ?? (result.provider ? [result.provider] : []),
          providerRank: result.providerRank ?? result.index,
          sourceType: classification.type,
          ...(affiliation ? { affiliation } : {}),
          semanticRelevance: result.semanticRelevance,
        };
        progress.fetchStatusCounts[fetchStatus]++;
        progress.sourcesProcessed++;
        await save("fetching", {
          percent: 34 + Math.floor((progress.sourcesProcessed / Math.max(selected.length, 1)) * 25),
          sourcesProcessed: progress.sourcesProcessed,
        });
        return candidate;
      },
    );
    const finalSources = loaded.filter((source): source is Candidate => source !== null);
    if (finalSources.length < selected.length) partial = true;
    for (const [index, source] of finalSources.entries()) {
      source.number = index + 1;
      const [stored] = await db
        .insert(osintSources)
        .values({
          runId,
          n: source.number,
          title: source.title,
          url: source.url,
          domain: source.domain,
          language: source.language,
          publishedAt: source.publishedAt ?? null,
          sourceType: source.sourceType,
          affiliation: source.affiliation ?? null,
          providers: source.providers,
          providerRank: source.providerRank,
          summary: null,
          snippet: source.searchText,
          fetched: source.fetched,
          fetchStatus: source.fetchStatus,
        })
        .returning({ id: osintSources.id });
      if (!stored) throw new Error("Source metadata insert failed.");
      source.sourceId = stored.id;
    }

    await save("summarizing", { percent: 64, sourcesFound: finalSources.length });
    const summaryInputs = finalSources.map((source) => ({
      number: source.number,
      title: source.title,
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      text: source.pageText,
      fetched: source.fetched,
    }));
    const summaryOutcome =
      remaining(start) > 1_000
        ? await summarizeSources({
            query: run.query,
            sources: summaryInputs,
            light: providers!.light,
            thinkingLevel: env.OSINT_THINKING_LEVEL,
            signal: aborter.signal,
            canRetry: () => !aborter.signal.aborted && remaining(start) > 1_000,
          })
        : skippedSummaryOutcome(summaryInputs);
    const summariesByNumber = summaryOutcome.summaries;
    const summaryStatuses = summaryOutcome.statuses;
    const summaryFailures = summaryOutcome.failureReasons;
    const summaryStatusCounts: Partial<Record<SummaryStatus, number>> = {};
    for (const source of finalSources) {
      const structured = summariesByNumber.get(source.number) ?? null;
      if (structured) source.structuredSummary = structured;
      else delete source.structuredSummary;
      source.summary = structured?.summary ?? null;
      let missingStatus: SummaryStatus | null = null;
      if (structured) {
        delete source.summaryStatus;
      } else {
        missingStatus = summaryStatuses.get(source.number) ?? "generation_failed";
        source.summaryStatus = missingStatus;
        summaryStatusCounts[missingStatus] = (summaryStatusCounts[missingStatus] ?? 0) + 1;
      }
      await db
        .update(osintSources)
        .set({
          summary: source.summary,
          structuredSummary: structured ?? { summaryStatus: missingStatus },
        })
        .where(eq(osintSources.id, source.sourceId!));
    }
    llmAttempts.summary = summaryOutcome.calls;
    progress.summaryStatusCounts = summaryStatusCounts;
    progress.summaryFailureReasons = summaryFailures;
    if (summaryStatusCounts && Object.keys(summaryStatusCounts).length) {
      partial = true;
      fail("summarizing:incomplete_sources");
    }

    await save("synthesizing", { percent: 84 });
    let report: StoredStructuredReport | null = null;
    const summarizedSources = finalSources.filter(
      (source): source is Candidate & { structuredSummary: SourceSummary } =>
        Boolean(source.structuredSummary),
    );
    if (summarizedSources.length && remaining(start) > 1_000) {
      const synthesis = await synthesizeReport({
        query: run.query,
        sources: summarizedSources.map((source) => ({
          number: source.number,
          title: source.structuredSummary.title,
          domain: source.domain,
          language: source.language,
          sourceType: source.sourceType,
          publicationDate: source.structuredSummary.publicationDate,
          summary: source.structuredSummary.summary,
          claims: source.structuredSummary.claims,
          entities: source.structuredSummary.entities,
          eventDate: source.structuredSummary.eventDate,
          quote: source.structuredSummary.quote,
          relevance: source.structuredSummary.relevance,
        })),
        light: providers!.light,
        thinkingLevel: env.OSINT_THINKING_LEVEL,
        signal: aborter.signal,
        canRetry: () => !aborter.signal.aborted && remaining(start) > 1_000,
      });
      report = synthesis.report;
      llmAttempts.report = synthesis.attempts;
      for (const failure of synthesis.failures) fail(failure.name, failure.error);
      progress.reportNotes = synthesis.notes;
    }
    if (finalSources.length && !summarizedSources.length)
      fail("synthesizing", new Error("No summaries available."));
    if (summarizedSources.length && !report && remaining(start) <= 1_000)
      fail("synthesizing", new Error("Step timeout."));
    if (report) {
      report = keepExplicitTimelineDates(
        report,
        summarizedSources.map((source) => ({
          number: source.number,
          eventDate: source.structuredSummary.eventDate,
          publicationDate: source.structuredSummary.publicationDate,
        })),
      );
    }
    const summary = report
      ? reportSummaryText(report)
      : finalSources.length
        ? null
        : az.osint.noSources;

    await queue;
    closeStage("done");
    const completed = await db
      .update(osintRuns)
      .set({
        status: partial ? "partial" : "done",
        step: partial ? "partial" : "done",
        progress: {
          ...progress,
          diagnostics: diagnostics(),
          percent: partial ? Math.min(progress.percent, 99) : 100,
          partial,
          ...(partial ? { notice: progress.notice ?? az.osint.partialNotice } : {}),
        },
        summary,
        structuredReport: report,
        error: null,
        finishedAt: new Date(),
      })
      .where(and(eq(osintRuns.id, runId), inArray(osintRuns.status, ["queued", "running"])))
      .returning({ id: osintRuns.id });
    if (!completed.length) return;

    for (const [provider, usage] of providerUsage) {
      console.info(
        "[OSINT] provider=" +
          provider +
          " requests=" +
          usage.calls +
          " results=" +
          usage.results +
          " duration=" +
          ((Date.now() - usage.started) / 1000).toFixed(1) +
          "s",
      );
    }
    if (run.cacheKey) {
      const expiresAt = new Date(Date.now() + cacheTtl(period));
      await db
        .insert(osintCache)
        .values({ cacheKey: run.cacheKey, runId, expiresAt })
        .onConflictDoUpdate({ target: osintCache.cacheKey, set: { runId, expiresAt } });
    }
  } catch (error) {
    const [current] = await db
      .select({ status: osintRuns.status })
      .from(osintRuns)
      .where(eq(osintRuns.id, runId))
      .limit(1);
    if (
      !current ||
      current.status === "done" ||
      current.status === "partial" ||
      current.status === "failed"
    )
      return;
    console.error("[OSINT] step=" + step + " error=" + osintFailureCategory(error));
    closeStage("failed");
    if (!progress.failedSteps.includes(step)) fail(step, error);
    const existing = await db
      .select()
      .from(osintSources)
      .where(eq(osintSources.runId, runId))
      .orderBy(osintSources.n);
    if (existing.length) {
      await db
        .update(osintRuns)
        .set({
          status: "partial",
          step: "partial",
          progress: {
            ...progress,
            percent: Math.min(progress.percent, 99),
            partial: true,
            diagnostics: diagnostics(),
          },
          summary: null,
          structuredReport: null,
          error: null,
          finishedAt: new Date(),
        })
        .where(and(eq(osintRuns.id, runId), inArray(osintRuns.status, ["queued", "running"])));
    } else {
      await db
        .update(osintRuns)
        .set({
          status: "failed",
          step: "failed",
          progress: { ...progress, partial: false, diagnostics: diagnostics() },
          summary: null,
          structuredReport: null,
          error: az.osint.jobFailed,
          finishedAt: new Date(),
        })
        .where(and(eq(osintRuns.id, runId), inArray(osintRuns.status, ["queued", "running"])));
    }
  } finally {
    clearTimeout(timer);
  }
}
