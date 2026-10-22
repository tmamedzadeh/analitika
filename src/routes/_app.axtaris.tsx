import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { BriefMarkdown } from "@/components/BriefMarkdown";
import { DirectionMultiSelect } from "@/components/DirectionMultiSelect";
import { Shell } from "@/components/Shell";
import { ZirveLoader } from "@/components/ZirveLoader";
import type { AnalyticsFilters, AnalyticsSourcePreview } from "@/lib/analytics";
import { getAnalyticsQueryHistory, listRecentAnalyticsQueries } from "@/lib/analytics.functions";
import { directionIds, directionLabel } from "@/lib/directions";
import { briefRouteForSearchSource, briefSearchLabel } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";
import { infoCredibilityValues, sourceReliabilityValues } from "@/lib/reliability";

const initialFilters: AnalyticsFilters = {
  period: "7d",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

export const Route = createFileRoute("/_app/axtaris")({
  head: () => ({
    meta: [
      { title: "Analitika üzrə axtarış" },
      { name: "description", content: "Sənədlər üzrə mənbəli analitik axtarış və sintez." },
      { property: "og:title", content: "Analitika üzrə axtarış" },
      { property: "og:description", content: "Sənədlər üzrə mənbəli analitik axtarış və sintez." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Analytics,
});

function historyStatusLabel(status: string): string {
  if (status === "running") return az.analytics.historyRunning;
  if (status === "done") return az.analytics.historyDone;
  if (status === "incomplete") return az.analytics.historyIncomplete;
  if (status === "cancelled") return az.analytics.historyCancelled;
  return az.analytics.historyFailedStatus;
}

function sourceUrl(source: AnalyticsSourcePreview): string {
  return briefRouteForSearchSource(source) ?? "#";
}

function citationMarkdown(answer: string) {
  return answer.replace(/\[(\d+)\](?!\()/g, "[$1](#citation-$1)");
}

function citedSourceNumbers(answer: string): Set<number> {
  return new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
}

function ReliabilityBadges({ source }: { source: AnalyticsSourcePreview }) {
  if (source.sourceReliability === null || source.infoCredibility === null) return null;
  const defaultSourceRating = source.sourceReliability === "F";
  const defaultInfoRating = source.infoCredibility === 6;
  const sourceLabel = az.reliability.sourceBadge + " " + source.sourceReliability;
  const infoLabel = az.reliability.informationBadge + " " + source.infoCredibility;
  return (
    <div className="flex flex-wrap gap-1.5">
      <span
        className={
          "label-mono rounded-full border px-2 py-1 " +
          (defaultSourceRating
            ? "border-border text-muted-foreground/60"
            : "border-primary/30 text-primary")
        }
        title={az.reliability.source[source.sourceReliability]}
        tabIndex={0}
        aria-label={sourceLabel + ": " + az.reliability.source[source.sourceReliability]}
      >
        {sourceLabel}
      </span>
      <span
        className={
          "label-mono rounded-full border px-2 py-1 " +
          (defaultInfoRating
            ? "border-border text-muted-foreground/60"
            : "border-primary/30 text-primary")
        }
        title={az.reliability.information[source.infoCredibility]}
        tabIndex={0}
        aria-label={infoLabel + ": " + az.reliability.information[source.infoCredibility]}
      >
        {infoLabel}
      </span>
    </div>
  );
}

function Analytics() {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters);
  const [sources, setSources] = useState<AnalyticsSourcePreview[]>([]);
  const [answer, setAnswer] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [errorReference, setErrorReference] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [sourceOnly, setSourceOnly] = useState(false);
  const [selectedHistory, setSelectedHistory] =
    useState<Awaited<ReturnType<typeof getAnalyticsQueryHistory>>>(null);
  const noDirections = filters.directionIds.length === 0;
  const usedSourceNumbers = citedSourceNumbers(answer);
  const visibleSources = sourceOnly
    ? sources
    : sources.filter((source) => usedSourceNumbers.has(source.n));
  const visibleSourceCount = selectedHistory
    ? selectedHistory.sources.filter((source) => source.available).length
    : visibleSources.length;

  const historyQuery = useQuery({
    queryKey: ["analytics", "history"],
    queryFn: () => listRecentAnalyticsQueries(),
    refetchInterval: busy ? 2_000 : false,
  });

  async function runSearch(
    mode: "answer" | "sources",
    override?: { query: string; filters: AnalyticsFilters },
  ) {
    const normalizedQuestion = (override?.query ?? question).trim();
    const activeFilters = override?.filters ?? filters;
    if (!normalizedQuestion || busy || noDirections) return;
    setBusy(true);
    setHasSearched(true);
    setSourceOnly(mode === "sources");
    setPageError("");
    setSelectedHistory(null);
    setErrorReference("");
    setAnswer("");
    setSources([]);
    setIncomplete(false);
    setElapsedMs(null);

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 100_000);
    let requestId = "";
    try {
      const response = await fetch("/api/analytics/search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ query: normalizedQuestion, filters: activeFilters, mode }),
        signal: abortController.signal,
      });
      requestId = response.headers.get("x-analytics-request-id") ?? "";
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string;
          requestId?: string;
        } | null;
        requestId = data?.requestId ?? requestId;
        throw new Error(data?.message || az.analytics.searchFailed);
      }
      if (!response.body) throw new Error(az.analytics.searchFailed);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedTerminalEvent = false;
      const readEvent = (frame: string) => {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) return;
        const event = JSON.parse(data) as {
          type: string;
          sources?: AnalyticsSourcePreview[];
          text?: string;
          answer?: string;
          incomplete?: boolean;
          durationMs?: number;
          message?: string;
          requestId?: string;
        };
        if (event.type === "sources") setSources(event.sources ?? []);
        if (event.type === "delta") setAnswer((current) => current + (event.text ?? ""));
        if (event.type === "final") {
          receivedTerminalEvent = true;
          setAnswer(event.answer ?? "");
          setIncomplete(Boolean(event.incomplete));
          setElapsedMs(event.durationMs ?? null);
        }
        if (event.type === "error") {
          receivedTerminalEvent = true;
          setAnswer("");
          setSources([]);
          setIncomplete(false);
          setElapsedMs(null);
          setPageError(event.message || az.analytics.answerFailed);
          setErrorReference(event.requestId || requestId);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          readEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) readEvent(buffer);
      if (!receivedTerminalEvent) {
        setAnswer("");
        setSources([]);
        setIncomplete(false);
        setElapsedMs(null);
        setPageError(az.analytics.answerFailed);
        setErrorReference(requestId);
      }
    } catch (error) {
      setAnswer("");
      setSources([]);
      setIncomplete(false);
      setElapsedMs(null);
      setPageError(
        abortController.signal.aborted
          ? az.analytics.timeout
          : error instanceof Error
            ? error.message
            : az.analytics.searchFailed,
      );
      setErrorReference(requestId);
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ["analytics", "history"] });
    }
  }

  async function openHistory(id: string) {
    try {
      const record = await getAnalyticsQueryHistory({ data: { id } });
      if (!record) throw new Error(az.analytics.historyOpenFailed);
      setSelectedHistory(record);
      setQuestion(record.query);
      setFilters(record.filters);
      setSources([]);
      setAnswer(record.answer);
      setIncomplete(record.status === "incomplete");
      setElapsedMs(record.durationMs);
      setHasSearched(true);
      setSourceOnly(false);
      setPageError("");
      setErrorReference("");
    } catch {
      setPageError(az.analytics.historyOpenFailed);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch("answer");
  }

  return (
    <Shell crumb={az.analytics.crumb} title={az.analytics.title} badges={[az.analytics.modelBadge]}>
      <form onSubmit={submit} className="panel panel-glow flex flex-col gap-3 p-5 sm:flex-row">
        <input
          className="field"
          placeholder={az.analytics.questionPlaceholder}
          aria-label={az.analytics.questionLabel}
          maxLength={1000}
          value={question}
          onChange={(event) => setQuestion(event.currentTarget.value)}
          required
        />
        <button
          className="glow rounded-xl bg-primary px-7 py-3 font-semibold text-primary-foreground disabled:opacity-60"
          disabled={busy || noDirections || question.trim().length === 0}
          type="submit"
        >
          {busy ? az.analytics.searching : az.analytics.searchButton}
        </button>
      </form>

      <section className="panel mt-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span>{az.analytics.periodLabel}</span>
          <select
            className="field"
            value={filters.period}
            onChange={(event) => {
              const value = event.currentTarget.value as AnalyticsFilters["period"];
              setFilters((current) => ({
                ...current,
                period: value,
              }));
            }}
          >
            <option value="7d">{az.analytics.period7d}</option>
            <option value="30d">{az.analytics.period30d}</option>
            <option value="90d">{az.analytics.period90d}</option>
            <option value="12m">{az.analytics.period12m}</option>
            <option value="all">{az.analytics.all}</option>
          </select>
        </label>
        <div className="min-w-0">
          <DirectionMultiSelect
            value={filters.directionIds}
            onChange={(next) => setFilters((current) => ({ ...current, directionIds: next }))}
          />
          {noDirections && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {az.directions.required}
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="">{az.analytics.sourceReliabilityFilter}</span>
          <select
            className="field"
            value={filters.minSourceReliability}
            onChange={(event) => {
              const value = event.currentTarget.value as AnalyticsFilters["minSourceReliability"];
              setFilters((current) => ({ ...current, minSourceReliability: value }));
            }}
          >
            <option value="all">{az.analytics.all}</option>
            {sourceReliabilityValues.map((value) => (
              <option key={value} value={value}>
                {value} · {az.reliability.source[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="">{az.analytics.infoReliabilityFilter}</span>
          <select
            className="field"
            value={filters.minInfoCredibility}
            onChange={(event) => {
              const value = event.currentTarget.value as AnalyticsFilters["minInfoCredibility"];
              setFilters((current) => ({ ...current, minInfoCredibility: value }));
            }}
          >
            <option value="all">{az.analytics.all}</option>
            {infoCredibilityValues.map((value) => (
              <option key={value} value={value}>
                {value} · {az.reliability.information[value]}
              </option>
            ))}
          </select>
        </label>
      </section>
      <p className="mt-2 text-sm text-muted-foreground">{az.analytics.briefSearchNote}</p>

      {pageError && (
        <div role="alert" className="mt-4 rounded-xl border border-destructive/40 p-4 text-sm">
          {pageError}
          {errorReference && (
            <p className="mt-1 text-xs text-muted-foreground">
              {az.analytics.errorReference} {errorReference}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_352px]">
        <div className="min-w-0 space-y-6">
          <section className="panel h-fit p-6">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="label-mono text-primary!">{az.analytics.synthesis}</span>
              <span className="label-mono">
                {busy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ZirveLoader variant="inline" label="" />
                    {az.analytics.generating}
                  </span>
                ) : elapsedMs === null ? (
                  hasSearched ? (
                    az.analytics.sourcesCount.replace("{count}", String(visibleSourceCount))
                  ) : (
                    az.analytics.waiting
                  )
                ) : (
                  az.analytics.timing
                    .replace("{seconds}", (elapsedMs / 1000).toFixed(1))
                    .replace("{count}", String(visibleSourceCount))
                )}
              </span>
            </div>
            {incomplete && (
              <p className="mt-4 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-700">
                {az.analytics.incompleteAnswer}
              </p>
            )}
            <div aria-live="polite" className="mt-4">
              {answer ? (
                <BriefMarkdown
                  markdown={citationMarkdown(answer)}
                  linkRenderer={(href, children) => {
                    const match = /^#citation-(\d+)$/.exec(href ?? "");
                    if (!match) return undefined;
                    const source = sources.find((candidate) => candidate.n === Number(match[1]));
                    return source ? (
                      <a
                        className="cite"
                        href={`#source-${source.n}`}
                        aria-label={az.analytics.openSource.replace("{n}", String(source.n))}
                      >
                        [{children}]
                      </a>
                    ) : (
                      <span className="cite">[{children}]</span>
                    );
                  }}
                />
              ) : busy ? (
                <p className="text-muted-foreground">{az.analytics.generating}</p>
              ) : (sourceOnly || selectedHistory) && visibleSourceCount > 0 ? (
                <p className="text-muted-foreground">{az.analytics.fragmentsOnly}</p>
              ) : hasSearched ? (
                <p className="text-muted-foreground">{az.analytics.noSources}</p>
              ) : (
                <p className="text-muted-foreground">{az.analytics.emptyState}</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              <button
                className="pill disabled:opacity-50"
                type="button"
                disabled={!hasSearched || busy || noDirections}
                onClick={() => void runSearch("sources")}
              >
                {az.analytics.showOnlyFragments}
              </button>
              <button
                className="pill disabled:opacity-50"
                type="button"
                disabled={!hasSearched || busy || noDirections || question.trim().length === 0}
                onClick={() => void runSearch("answer")}
              >
                {az.analytics.regenerate}
              </button>
              {selectedHistory && (
                <button
                  className="pill disabled:opacity-50"
                  type="button"
                  disabled={busy || noDirections}
                  onClick={() =>
                    void runSearch("answer", {
                      query: selectedHistory.query,
                      filters: selectedHistory.filters,
                    })
                  }
                >
                  {az.analytics.historyRerun}
                </button>
              )}
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="label-mono">{az.analytics.sources}</p>
              {hasSearched && (!busy || sourceOnly) ? (
                <span className="label-mono">
                  {az.analytics.sourcesCount.replace("{count}", String(visibleSourceCount))}
                </span>
              ) : null}
            </div>
            <div className="space-y-3">
              {selectedHistory
                ? selectedHistory.sources.map((source) => (
                    <article key={`${source.n}-${source.title}`} className="panel p-5">
                      <h3 className="break-words font-semibold [overflow-wrap:anywhere]">
                        <span className="cite ml-0! mr-1">{source.n}</span>
                        {source.title}
                      </h3>
                      {source.caption && <p className="label-mono mt-2">{source.caption}</p>}
                      <p className="label-mono mt-2">
                        {source.available
                          ? source.usedInAnswer
                            ? az.analytics.sourceUsedInAnswer
                            : az.analytics.sourceNotUsedInAnswer
                          : az.analytics.sourceUnavailable}
                      </p>
                      {source.available && (source.documentId || source.briefId) && (
                        <a
                          className="pill mt-3 inline-flex"
                          href={
                            source.documentId
                              ? `/senedler/${encodeURIComponent(source.documentId)}`
                              : `/brifler/${encodeURIComponent(source.briefId!)}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.documentId ? az.analytics.openDocument : az.analytics.openBrief}
                        </a>
                      )}
                    </article>
                  ))
                : visibleSources.map((source) => (
                    <article
                      key={source.chunkId}
                      id={`source-${source.n}`}
                      className="panel scroll-mt-6 p-5"
                      tabIndex={-1}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="break-words font-semibold [overflow-wrap:anywhere]">
                          <span className="cite ml-0! mr-1">{source.n}</span>
                          {source.title}
                        </h3>
                        {source.sourceKind === "brief" ? (
                          <span className="label-mono">
                            {briefSearchLabel(source.briefDate ?? "")}
                          </span>
                        ) : (
                          <ReliabilityBadges source={source} />
                        )}
                      </div>
                      <p className="label-mono mt-2">
                        {(source.sourceKind === "brief"
                          ? [source.sectionTitle || az.analytics.sectionUnknown]
                          : [
                              directionLabel(source.direction) ?? az.directions.unassigned,
                              source.sectionTitle || az.analytics.sectionUnknown,
                              source.docDate,
                            ]
                        )
                          .filter(Boolean)
                          .join(" · ")}
                        {source.isTable ? " · " + az.analytics.table : ""}
                      </p>
                      {source.quote && <p className="mt-2 text-sm">«{source.quote}»</p>}
                      <a
                        className="pill mt-3 inline-flex"
                        href={sourceUrl(source)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.sourceKind === "brief"
                          ? briefSearchLabel(source.briefDate ?? "")
                          : az.analytics.openDocument}
                        {source.attachmentCount > 0
                          ? " · " + source.attachmentCount + " " + az.analytics.photos
                          : ""}
                      </a>
                    </article>
                  ))}
              {hasSearched && visibleSourceCount === 0 && !busy && !pageError && (
                <div className="panel p-5 text-sm text-muted-foreground">
                  {az.analytics.noSources}
                </div>
              )}
              {!hasSearched && (
                <div className="panel p-5 text-sm text-muted-foreground">
                  {az.analytics.sourcesHint}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside>
          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="label-mono">{az.analytics.historyTitle}</h2>
              {historyQuery.isFetching && <ZirveLoader variant="inline" label="" />}
            </div>
            {historyQuery.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {az.analytics.historyFailed}
              </p>
            ) : historyQuery.data?.length ? (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {historyQuery.data.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full rounded-lg border border-border p-3 text-left hover:border-primary/40"
                    onClick={() => void openHistory(item.id)}
                  >
                    <span className="block line-clamp-2 text-sm font-medium">{item.query}</span>
                    <span className="label-mono mt-1 block">
                      {historyStatusLabel(item.status)}
                      {item.author ? ` · ${item.author}` : ""}
                      {` · ${new Date(item.createdAt).toLocaleString("az-AZ")}`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{az.analytics.historyEmpty}</p>
            )}
          </section>
        </aside>
      </div>
    </Shell>
  );
}
