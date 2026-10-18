import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { BriefMarkdown } from "@/components/BriefMarkdown";
import { Shell } from "@/components/Shell";
import { az } from "@/lib/i18n/az";
import { getOsintRun, listOsintRuns, startOsintRun } from "@/lib/osint.functions";
import {
  OSINT_LANGUAGES,
  OSINT_PERIODS,
  osintLanguageNames,
  type OsintLanguage,
  type OsintPeriod,
} from "@/lib/osint";

export const Route = createFileRoute("/osint")({
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

function Osint() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [languages, setLanguages] = useState<OsintLanguage[]>([...OSINT_LANGUAGES]);
  const [period, setPeriod] = useState<OsintPeriod>("30d");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cacheNotice, setCacheNotice] = useState("");

  const historyQuery = useQuery({
    queryKey: ["osint-runs"],
    queryFn: () => listOsintRuns(),
    refetchInterval: 5000,
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
                {az.osint.period}: {periodLabels[value]}
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
          {cacheNotice}
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
              <p className="label-mono !text-primary">{az.osint.progress}</p>
              {run && !isActive ? (
                <button
                  type="button"
                  className="pill"
                  disabled={submitting}
                  onClick={() => void executeSearch(true)}
                >
                  {az.osint.refresh}
                </button>
              ) : null}
            </div>
            {!run ? (
              <p className="mt-4 text-muted-foreground">
                {runQuery.isLoading ? az.osint.loading : az.osint.noProgress}
              </p>
            ) : (
              <>
                <p className="mt-3 font-medium">
                  {az.osint.step[run.step as keyof typeof az.osint.step] ?? run.step}
                </p>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress?.percent ?? 0}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${progress?.percent ?? 0}%` }}
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
                  {interpolate(az.osint.requestBudget, {
                    calls: progress?.llmCalls ?? 0,
                    budget: progress?.llmCallBudget ?? 10,
                  })}
                  {" · "}
                  {interpolate(az.osint.searchBudget, {
                    calls: progress?.searchCalls ?? 0,
                    budget: progress?.providerCallBudget ?? 8,
                  })}
                </p>
                {progress?.partial ? (
                  <p className="mt-3 text-sm text-amber-700">{az.osint.partialNotice}</p>
                ) : null}
                {run.error ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {run.error}
                  </p>
                ) : null}
                {progress?.failedSteps.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {interpolate(az.osint.failedSteps, { steps: progress.failedSteps.join(", ") })}
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="panel p-5 sm:p-6">
            <p className="label-mono !text-primary">{az.osint.summary}</p>
            {run?.summary ? (
              <div className="mt-4 text-base leading-7">
                <BriefMarkdown markdown={run.summary} />
              </div>
            ) : (
              <p className="mt-4 text-muted-foreground">
                {isActive ? az.osint.waitingSummary : az.osint.noSummary}
              </p>
            )}
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
              <div className="grid gap-3 sm:grid-cols-2">
                {runSources.map((source, index) => (
                  <article className="panel min-w-0 p-5" key={source.id}>
                    <h2 className="font-semibold leading-snug">
                      <span className="cite !ml-0 mr-1">{index + 1}</span>
                      {source.title}
                    </h2>
                    <p className="label-mono mt-2 break-all">
                      {source.domain} · {source.language.toUpperCase()} ·{" "}
                      {az.osint.fetchStatus[
                        source.fetchStatus as keyof typeof az.osint.fetchStatus
                      ] ?? source.fetchStatus}
                    </p>
                    <div className="mt-3 line-clamp-5 text-sm leading-6">
                      <BriefMarkdown
                        markdown={source.summary || source.snippet || az.osint.fetchingFailed}
                      />
                    </div>
                    {source.publishedAt ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {az.osint.date}: {new Date(source.publishedAt).toLocaleDateString("az-AZ")}
                      </p>
                    ) : null}
                    <a
                      className="pill mt-3 inline-flex"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {az.osint.openOriginal}
                    </a>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <p className="label-mono mb-3">{az.osint.history}</p>
          {history.length === 0 ? (
            <div className="panel p-5 text-sm text-muted-foreground">
              {historyQuery.isLoading ? az.osint.loading : az.osint.noHistory}
            </div>
          ) : (
            <div className="space-y-2">
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
                        : "30d",
                    );
                  }}
                  className={`panel w-full p-4 text-left transition-colors hover:border-primary/50 ${selectedRunId === item.id ? "border-primary" : ""}`}
                >
                  <span className="block line-clamp-2 font-medium">{item.query}</span>
                  <span className="mt-2 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {az.osint.step[item.step as keyof typeof az.osint.step] ?? item.step}
                    </span>
                    <span>· {new Date(item.createdAt).toLocaleString("az-AZ")}</span>
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
