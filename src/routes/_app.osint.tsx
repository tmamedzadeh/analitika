import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import { OsintDiagnosticsPanel } from "@/components/OsintDiagnostics";
import { Shell } from "@/components/Shell";
import { ZirveLoader } from "@/components/ZirveLoader";
import { az } from "@/lib/i18n/az";
import {
  getOsintRun,
  listOsintRuns,
  retryOsintSummary,
  startOsintRun,
} from "@/lib/osint.functions";
import { buildReportHtml, buildReportMarkdown, writeReportToClipboard } from "@/lib/osint-copy";
import { plainTextFragment } from "@/lib/osint-text";
import {
  OSINT_LANGUAGES,
  OSINT_PERIODS,
  osintLanguageNames,
  type OsintLanguage,
  type OsintPeriod,
} from "@/lib/osint";

export const Route = createFileRoute("/_app/osint")({
  head: () => ({
    meta: [
      { title: `${az.osint.title} · Analitika` },
      { name: "description", content: az.osint.description },
      { property: "og:title", content: `${az.osint.title} · Analitika` },
      { property: "og:description", content: az.osint.description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Osint,
});

const periodLabels: Record<OsintPeriod, string> = {
  "24h": az.osint.periods["24h"],
  "7d": az.osint.periods["7d"],
  "30d": az.osint.periods["30d"],
  all: az.osint.periods.all,
};

function interpolate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function displayRunStep(step: string, status: string): string {
  if (Object.prototype.hasOwnProperty.call(az.osint.step, step)) {
    return az.osint.step[step as keyof typeof az.osint.step];
  }
  if (status === "running") return az.osint.step.summarizing;
  if (status === "partial") return az.osint.step.partial;
  if (status === "failed") return az.osint.step.failed;
  return az.osint.step.queued;
}

type OsintRunData = NonNullable<Awaited<ReturnType<typeof getOsintRun>>>;
type RunSource = OsintRunData["sources"][number];

function SourceCard({ source }: { source: RunSource }) {
  const missingText = source.summary
    ? null
    : (az.osint.summaryStatus[source.summaryStatus as keyof typeof az.osint.summaryStatus] ??
      az.osint.summaryFailed);
  const relevanceLabel =
    source.relevance === "tangential" || source.relevance === "offtopic"
      ? az.osint.relevance[source.relevance]
      : null;
  return (
    <article className="panel min-w-0 p-5" id={"osint-source-" + source.n}>
      <h2 className="font-semibold leading-snug">
        <span className="cite ml-0! mr-1">{source.n}</span>
        {source.structuredSummary?.title || source.domain}
      </h2>
      {source.sourceType !== "other" ? (
        <p className="label-mono mt-2">
          {az.osint.sourceType[source.sourceType as keyof typeof az.osint.sourceType] ??
            source.sourceType}
        </p>
      ) : null}
      <p className="label-mono mt-2 break-all">
        {source.domain} · {osintLanguageNames[source.language as OsintLanguage] ?? source.language}{" "}
        · {source.fetched ? az.osint.fullText : az.osint.shortFragment}
      </p>
      {relevanceLabel ? <p className="mt-2 text-xs text-amber-700">{relevanceLabel}</p> : null}
      <p className="mt-3 line-clamp-5 text-sm leading-6">
        {source.summary ? plainTextFragment(source.summary, 1_600) : missingText}
      </p>
      {source.publishedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {az.osint.date}:{" "}
          {new Intl.DateTimeFormat("az-AZ", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(new Date(source.publishedAt))}
        </p>
      ) : null}
      {source.structuredSummary?.quote ? (
        <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-sm italic">
          {source.structuredSummary.quote}
          <span className="mt-1 block text-xs not-italic text-muted-foreground">
            {az.osint.sourceQuote}
          </span>
        </blockquote>
      ) : null}
      {source.providers.length ? (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{az.osint.details}</summary>
          <p className="mt-1">
            {source.providers
              .map((provider) => provider[0]?.toUpperCase() + provider.slice(1))
              .join(" + ")}
          </p>
        </details>
      ) : null}
      <a className="pill mt-3 inline-flex" href={source.url} target="_blank" rel="noreferrer">
        {az.osint.openOriginal}
      </a>
      {!source.summary ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer">{az.osint.originalFragment}</summary>
          <p className="mt-2 whitespace-pre-wrap">{plainTextFragment(source.snippet || "")}</p>
        </details>
      ) : null}
    </article>
  );
}

function Osint() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [languages, setLanguages] = useState<OsintLanguage[]>([...OSINT_LANGUAGES]);
  const [period, setPeriod] = useState<OsintPeriod>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cacheNotice, setCacheNotice] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");

  const historyQuery = useQuery({
    queryKey: ["osint-runs"],
    queryFn: () => listOsintRuns(),
    refetchInterval: (queryState) =>
      queryState.state.data?.some((run) => run.status === "queued" || run.status === "running")
        ? 5000
        : false,
  });
  const runQuery = useQuery({
    queryKey: ["osint-run", selectedRunId],
    queryFn: () => getOsintRun({ data: { runId: selectedRunId! } }),
    enabled: Boolean(selectedRunId),
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });

  function toggleLanguage(language: OsintLanguage) {
    setLanguages((current) =>
      current.includes(language)
        ? current.filter((item) => item !== language)
        : OSINT_LANGUAGES.filter((item) => current.includes(item) || item === language),
    );
  }

  async function executeSearch(refresh = false) {
    setFormError("");
    setCacheNotice("");
    setSubmitting(true);
    try {
      const result = await startOsintRun({ data: { query, languages, period, refresh } });
      setSelectedRunId(result.runId);
      if (result.cacheHit) setCacheNotice(az.osint.cached);
      await queryClient.invalidateQueries({ queryKey: ["osint-runs"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : az.osint.failed);
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void executeSearch();
  }

  const run = runQuery.data;
  const history = historyQuery.data ?? [];
  const runSources = run?.sources ?? [];
  const progress = run?.progress;
  const isActive = run?.status === "queued" || run?.status === "running";
  const report = run?.structuredReport;
  const coveredLanguages = new Set(runSources.map((source) => source.language)).size;
  const failureMessage = (() => {
    if (progress?.failureClass === "limit") return az.osint.limitError;
    if (progress?.failureClass === "search") return az.osint.searchSourceError;
    if (progress?.failureClass === "page") return az.osint.pageLoadError;
    if (progress?.failureClass === "llm" || run?.status === "failed") {
      return progress?.stage ? az.osint.stage[progress.stage] : az.osint.failed;
    }
    return "";
  })();
  const availabilityMessage =
    failureMessage && !isActive && run
      ? run.sources.length
        ? az.osint.resultsAvailable
        : az.osint.resultsUnavailable
      : "";
  const citationLinks = (numbers: number[]) =>
    numbers.map((number) => (
      <a className="cite ml-1!" key={number} href={"#osint-source-" + number}>
        [{number}]
      </a>
    ));
  const cacheAgeHours = run?.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(run.createdAt).getTime()) / 3_600_000))
    : 0;
  const mainSources = runSources.filter((source) => source.relevance !== "offtopic");
  const offTopicSources = runSources.filter((source) => source.relevance === "offtopic");

  async function regenerateSummaries(runId: string) {
    setRetryError("");
    setRetrying(true);
    try {
      await retryOsintSummary({ data: { runId } });
      await queryClient.invalidateQueries({ queryKey: ["osint-run", runId] });
      await queryClient.invalidateQueries({ queryKey: ["osint-runs"] });
    } catch {
      setRetryError(az.osint.retryFailed);
    } finally {
      setRetrying(false);
    }
  }

  async function copyReport() {
    if (!run || !report) return;
    const input = {
      applicationOrigin: window.location.origin,
      query: run.query,
      periodLabel: periodLabels[run.period as OsintPeriod] ?? run.period,
      languageLabels: run.languages.map(
        (language) => osintLanguageNames[language as OsintLanguage] ?? language,
      ),
      generatedAt: new Intl.DateTimeFormat("az-AZ", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(run.finishedAt ?? run.createdAt)),
      report,
      sources: run.sources.map((source) => ({
        n: source.n,
        title: source.structuredSummary?.title || source.domain,
        domain: source.domain,
        url: source.url,
        publishedAt: source.publishedAt,
      })),
    };
    const ok = await writeReportToClipboard({
      markdown: buildReportMarkdown(input),
      html: buildReportHtml(input),
    });
    setCopyState(ok ? "done" : "failed");
    window.setTimeout(() => setCopyState("idle"), 3000);
  }

  return (
    <Shell crumb={az.osint.title} title={az.osint.title} badges={[az.osint.providerBadge]}>
      <form onSubmit={submit} className="panel panel-glow p-5">
        <label className="label-mono" htmlFor="osint-query">
          {az.osint.queryLabel}
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="osint-query"
            className="field min-w-0 flex-1"
            value={query}
            maxLength={1000}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={az.osint.queryPlaceholder}
            required
          />
          <button
            className="glow whitespace-nowrap rounded-xl bg-primary px-7 py-3 font-semibold text-primary-foreground disabled:opacity-60"
            disabled={submitting || languages.length === 0 || query.trim().length < 3}
          >
            {submitting && <ZirveLoader variant="inline" label="" />}
            {submitting ? az.osint.searching : az.osint.search}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="label-mono mr-1">{az.osint.languages}</span>
          {OSINT_LANGUAGES.map((language) => (
            <button
              type="button"
              key={language}
              aria-pressed={languages.includes(language)}
              onClick={() => toggleLanguage(language)}
              className={`pill ${languages.includes(language) ? "pill-active" : ""}`}
            >
              {osintLanguageNames[language]}
            </button>
          ))}
          <label className="sr-only" htmlFor="osint-period">
            {az.osint.period}
          </label>
          <select
            id="osint-period"
            className="field ml-0 min-h-9 w-auto py-1 sm:ml-2"
            value={period}
            onChange={(event) => setPeriod(event.target.value as OsintPeriod)}
          >
            {OSINT_PERIODS.map((value) => (
              <option key={value} value={value}>
                {periodLabels[value]}
              </option>
            ))}
          </select>
        </div>
        {languages.length === 0 ? (
          <p className="mt-3 text-sm text-destructive">{az.osint.selectLanguage}</p>
        ) : null}
        {formError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
      </form>

      {cacheNotice ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"
        >
          {interpolate(az.osint.cachedAge, { hours: cacheAgeHours })}
        </p>
      ) : null}
      {historyQuery.isError ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-destructive/40 p-3 text-sm text-destructive"
        >
          {az.osint.historyFailed}
        </p>
      ) : null}
      {runQuery.isError ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-destructive/40 p-3 text-sm text-destructive"
        >
          {az.osint.loadFailed}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="panel p-5 sm:p-6" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono text-primary!">{az.osint.progress}</p>
              {run && !isActive ? (
                <button
                  type="button"
                  className="pill"
                  disabled={submitting}
                  onClick={() => void executeSearch(true)}
                >
                  {submitting && <ZirveLoader variant="inline" label="" />}
                  {az.osint.refresh}
                </button>
              ) : null}
            </div>
            {!run ? (
              runQuery.isPending && selectedRunId ? (
                <ZirveLoader variant="compact" className="mt-4" label={az.osint.loading} />
              ) : (
                <p className="mt-4 text-muted-foreground">{az.osint.noProgress}</p>
              )
            ) : (
              <>
                <p className="mt-3 font-medium">{displayRunStep(run.step, run.status)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {run.query} ·{" "}
                  {run.languages
                    .map((language) => osintLanguageNames[language as OsintLanguage] ?? language)
                    .join(", ")}{" "}
                  · {periodLabels[run.period as OsintPeriod] ?? run.period}
                </p>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(progress?.partial ? 99 : 100, progress?.percent ?? 0)}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{
                      width: `${Math.min(progress?.partial ? 99 : 100, progress?.percent ?? 0)}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {interpolate(az.osint.progressDetail, {
                    completed: progress?.completedLanguages ?? 0,
                    total: progress?.totalLanguages ?? languages.length,
                    sources: progress?.sourcesFound ?? 0,
                  })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {interpolate(az.osint.languageCoverage, { covered: coveredLanguages })}
                  {run.languages.length === 8 ? ` · ${az.osint.eightLanguages}` : ""}
                </p>
                {progress?.partial ? (
                  <p className="mt-3 text-sm text-amber-700">
                    {failureMessage || progress.notice || az.osint.partialNotice}
                  </p>
                ) : null}
                {progress?.fallbackProvider ? (
                  <p className="mt-3 text-sm text-amber-700">{az.osint.fallbackUsed}</p>
                ) : null}
                {failureMessage && !progress?.partial ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {failureMessage}
                  </p>
                ) : null}
                {availabilityMessage ? (
                  <p className="mt-1 text-sm text-muted-foreground">{availabilityMessage}</p>
                ) : null}
              </>
            )}
          </section>

          {run?.diagnostics ? (
            <OsintDiagnosticsPanel
              diagnostics={run.diagnostics}
              stepLabel={displayRunStep(run.step, run.status)}
              stageLabel={progress?.stage ? az.osint.stage[progress.stage] : undefined}
            />
          ) : null}

          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono text-primary!">{az.osint.reportBluf}</p>
              {report ? (
                <button
                  type="button"
                  className="pill inline-flex items-center gap-2"
                  aria-label={az.osint.copy.button}
                  title={az.osint.copy.button}
                  onClick={() => void copyReport()}
                >
                  <Copy aria-hidden="true" className="size-4" />
                  <span>{az.osint.copy.button}</span>
                </button>
              ) : null}
            </div>
            {copyState !== "idle" ? (
              <p role="status" className="mt-2 text-sm text-muted-foreground">
                {copyState === "done" ? az.osint.copy.done : az.osint.copy.failed}
              </p>
            ) : null}
            {report ? (
              <div className="mt-4 space-y-5 text-base leading-7">
                <p>
                  {report.bluf} {citationLinks(report.blufSourceNumbers)}
                </p>
                {report.keyFindings.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.keyFindings}</h2>
                    <ul className="mt-2 list-disc space-y-2 pl-5">
                      {report.keyFindings.map((finding, index) => (
                        <li key={index}>
                          {finding.text} {citationLinks(finding.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.entities.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.entities}</h2>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {report.entities.map((entity, index) => (
                        <li key={index} className="pill">
                          {entity.name} {citationLinks(entity.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.timeline.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.timeline}</h2>
                    <ul className="mt-2 space-y-2">
                      {report.timeline.map((item, index) => (
                        <li key={index}>
                          <strong>{item.date || az.osint.eventDateUnknown}</strong> — {item.event}{" "}
                          {citationLinks(item.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.perspectives.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.perspectives}</h2>
                    <ul className="mt-2 space-y-2">
                      {report.perspectives.map((item, index) => (
                        <li key={index}>
                          <strong>{item.group}:</strong> {item.summary}{" "}
                          {citationLinks(item.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.disagreements.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.disagreements}</h2>
                    <ul className="mt-2 space-y-3">
                      {report.disagreements.map((item, index) => (
                        <li key={index}>
                          <strong>{item.topic}</strong>
                          <ul className="ml-4 list-disc">
                            {item.positions.map((position, positionIndex) => (
                              <li key={positionIndex}>
                                <strong>{position.group}:</strong> {position.text}{" "}
                                {citationLinks(position.sourceNumbers)}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.gaps.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.gaps}</h2>
                    <ul className="mt-2 list-disc pl-5">
                      {report.gaps.map((item, index) => (
                        <li key={index}>
                          {item.text} {citationLinks(item.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.watch.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.watch}</h2>
                    <ul className="mt-2 list-disc pl-5">
                      {report.watch.map((item, index) => (
                        <li key={index}>
                          {item.text} {citationLinks(item.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.caveats.length ? (
                  <div>
                    <h2 className="label-mono">{az.osint.caveats}</h2>
                    <ul className="mt-2 list-disc pl-5">
                      {report.caveats.map((item, index) => (
                        <li key={index}>
                          {item.text} {citationLinks(item.sourceNumbers)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.weakFindings?.length ? (
                  <details className="text-sm">
                    <summary className="label-mono cursor-pointer">{az.osint.weakFindings}</summary>
                    <p className="mt-2 text-muted-foreground">{az.osint.weakFindingsNote}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {report.weakFindings.map((item, index) => (
                        <li key={index}>{item.text}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-muted-foreground">
                <p>
                  {isActive
                    ? az.osint.waitingSummary
                    : run?.sources.length
                      ? az.osint.reportFailed
                      : az.osint.noSummary}
                </p>
              </div>
            )}
            {run?.summaryRetryAvailable && !isActive ? (
              <div className="mt-4">
                <button
                  type="button"
                  className="pill"
                  disabled={retrying || submitting}
                  onClick={() => void regenerateSummaries(run.id)}
                >
                  {retrying && <ZirveLoader variant="inline" label="" />}
                  {retrying ? az.osint.retrying : az.osint.retrySummary}
                </button>
                {retryError ? (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {retryError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {runSources.length ? (
              <p className="label-mono mt-4">{az.osint.sourcesNotVerified}</p>
            ) : null}
          </section>

          <section>
            <p className="label-mono mb-3">
              {interpolate(az.osint.sourcesCount, { count: runSources.length })}
            </p>
            {runSources.length === 0 ? (
              <div className="panel p-5 text-sm text-muted-foreground">
                {run && !isActive ? az.osint.noSources : az.osint.sourcesWaiting}
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {mainSources.map((source) => (
                    <SourceCard key={source.id} source={source} />
                  ))}
                </div>
                {offTopicSources.length ? (
                  <details className="mt-4">
                    <summary className="label-mono cursor-pointer">
                      {az.osint.otherResults} · {offTopicSources.length}
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {offTopicSources.map((source) => (
                        <SourceCard key={source.id} source={source} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </section>
        </div>

        <aside>
          <p className="label-mono mb-3">{az.osint.history}</p>
          {history.length === 0 ? (
            historyQuery.isPending ? (
              <ZirveLoader variant="compact" label={az.osint.loading} />
            ) : (
              <div className="panel p-5 text-sm text-muted-foreground">{az.osint.noHistory}</div>
            )
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {history.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setSelectedRunId(item.id);
                    setQuery(item.query);
                    setLanguages(
                      item.languages.filter((language): language is OsintLanguage =>
                        (OSINT_LANGUAGES as readonly string[]).includes(language),
                      ),
                    );
                    setPeriod(
                      OSINT_PERIODS.includes(item.period as OsintPeriod)
                        ? (item.period as OsintPeriod)
                        : "all",
                    );
                  }}
                  className={`panel w-full p-4 text-left transition-colors hover:border-primary/50 ${selectedRunId === item.id ? "border-primary" : ""}`}
                >
                  <span className="block line-clamp-2 font-medium">{item.query}</span>
                  <span className="mt-2 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>{displayRunStep(item.step, item.status)}</span>
                    <span>· {new Date(item.createdAt).toLocaleString("az-AZ")}</span>
                    <span>· {item.author}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}
