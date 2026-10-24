import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, History, Square } from "lucide-react";

import { AnalyticsProgress } from "@/components/AnalyticsProgress";
import { AnalyticsAnswer } from "@/components/AnalyticsAnswer";
import { AnalyticsSourceCard } from "@/components/AnalyticsSourceCard";
import { DirectionMultiSelect } from "@/components/DirectionMultiSelect";
import { Shell } from "@/components/Shell";
import { ZirveLoader, ZirveSkeleton, ZirveActionLabel } from "@/components/ZirveLoader";
import type {
  AnalyticsFilters,
  AnalyticsSourcePreview,
  AnalyticsProgressStage,
} from "@/lib/analytics";
import {
  ANALYTICS_CLIENT_DEADLINE_MS,
  analyticsSourceCounts,
  isAnalyticsProgressStage,
  citedSourceNumbers,
  groupAnalyticsSources,
} from "@/lib/analytics";
import { getAnalyticsQueryHistory, listRecentAnalyticsQueries } from "@/lib/analytics.functions";
import { directionIds } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import type { ModelFallback } from "@/lib/ai";
import { createFallbackNotifier } from "@/lib/ai-notifications";
import { PeriodFilter } from "@/components/PeriodFilter";
import { ReliabilityFilters } from "@/components/ReliabilityFilters";
import { FilterBar } from "@/components/FilterBar";
import { analyticsFiltersSchema, isNewAnalyticsFilters } from "@/lib/analytics";

import {
  filterRouteSearchSchema,
  parseAnalyticsSearch,
  useFilterSearchState,
} from "@/lib/filter-search-state";

const initialFilters = analyticsFiltersSchema.parse({ directionIds: [...directionIds] });

export const Route = createFileRoute("/_app/axtaris")({
  validateSearch: filterRouteSearchSchema,
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

/** Material and fragment counts always describe the same authorized source set. */
function materialFragmentsLabel(
  materials: number,
  fragments: number,
  mode: "cited" | "retrieved",
): string {
  const materialsLabel = (
    mode === "cited" ? az.analytics.citedSourcesCount : az.analytics.retrievedSourcesCount
  ).replace("{count}", String(materials));
  const fragmentsLabel = (
    mode === "cited" ? az.analytics.citedFragmentsCount : az.analytics.retrievedFragmentsCount
  ).replace("{count}", String(fragments));
  return az.analytics.sourcesAndFragmentsCount
    .replace("{materials}", materialsLabel)
    .replace("{fragments}", fragmentsLabel);
}

export function Analytics() {
  const queryClient = useQueryClient();
  const navigationScope = useId();
  const [question, setQuestion] = useState("");
  const [filters, setFilters] = useFilterSearchState("filters", (value) =>
    parseAnalyticsSearch(value, initialFilters),
  );
  const [sources, setSources] = useState<AnalyticsSourcePreview[]>([]);
  const [answer, setAnswer] = useState("");
  const [model, setModel] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [sourceOnly, setSourceOnly] = useState(false);
  const [answerContext, setAnswerContext] = useState<{
    query: string;
    filters: AnalyticsFilters;
  } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const searchLock = useRef(false);
  const historyLock = useRef<string | null>(null);
  const operation = useRef(0);
  const [stage, setStage] = useState<AnalyticsProgressStage>("starting");
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      operation.current++;
      activeRequest.current?.abort();
    },
    [],
  );
  const [selectedHistory, setSelectedHistory] =
    useState<Awaited<ReturnType<typeof getAnalyticsQueryHistory>>>(null);
  const noDirections = filters.directionIds.length === 0;
  const usedSourceNumbers = citedSourceNumbers(answer);
  // History has its own authorized mappings; the live SSE list is empty when it opens.
  // Legacy parent-only snapshots remain navigable without inventing a fragment preview.
  const availableSources: AnalyticsSourcePreview[] = selectedHistory
    ? selectedHistory.sources.flatMap((source) => {
        if (!source.available || (!source.documentId && !source.briefId)) return [];
        if (source.preview) return [source.preview];
        return [
          {
            n: source.n,
            sourceKind: source.documentId ? "document" : "brief",
            documentId: source.documentId,
            briefId: source.briefId,
            chunkId: source.chunkId ?? "",
            title: source.title,
            sectionTitle: "",
            quote: "",
            docDate: null,
            briefDate: null,
            direction: null,
            classification: null,
            sourceReliability: null,
            infoCredibility: null,
            isTable: false,
            attachmentCount: 0,
          },
        ];
      })
    : sources;
  const retrievedCounts = analyticsSourceCounts(availableSources);
  const citedCounts = analyticsSourceCounts(availableSources, usedSourceNumbers);
  const sourcesAreCited = !sourceOnly && Boolean(answer);
  const shownGroups = groupAnalyticsSources(
    availableSources,
    sourcesAreCited ? usedSourceNumbers : undefined,
  );
  const unavailableSources =
    selectedHistory?.sources.filter(
      (source) => !source.available && (!sourcesAreCited || usedSourceNumbers.has(source.n)),
    ) ?? [];
  const shownCounts = sourcesAreCited ? citedCounts : retrievedCounts;
  const shownMode = sourcesAreCited ? "cited" : "retrieved";
  const sourceCountLabel = materialFragmentsLabel(
    shownCounts.materials,
    shownCounts.fragments,
    shownMode,
  );
  const sourceListCountLabel = sourceCountLabel;
  const shownFragmentLabel = sourcesAreCited
    ? az.analytics.citedFragmentsCount
    : az.analytics.retrievedFragmentsCount;

  const historyQuery = useQuery({
    queryKey: ["analytics", "history"],
    queryFn: () => listRecentAnalyticsQueries(),
    refetchInterval: busy ? 2_000 : false,
  });
  const displayedQuestion =
    answerContext?.query ??
    (historyLoading
      ? historyQuery.data?.find((item) => item.id === activeHistoryId)?.query
      : undefined);

  async function runSearch(
    mode: "answer" | "sources",
    override?: { query: string; filters: AnalyticsFilters },
  ) {
    const normalizedQuestion = (override?.query ?? question).trim();
    const activeFilters = override?.filters ?? filters;
    if (!normalizedQuestion || searchLock.current || activeFilters.directionIds.length === 0)
      return;
    if (!isNewAnalyticsFilters(activeFilters)) {
      setPageError(
        "Bu tarixçə əvvəlki dövr və hədd filtrlərini saxlayır. Yenidən axtarış üçün Dövr seçin və etibarlılıq filtrlərini yenidən təyin edin.",
      );
      return;
    }
    activeRequest.current?.abort();
    const token = ++operation.current;
    historyLock.current = null;
    setHistoryLoading(false);
    searchLock.current = true;
    setStage("starting");
    // The displayed answer owns this immutable request, independent of subsequent form edits.
    setAnswerContext({
      query: normalizedQuestion,
      filters: { ...activeFilters, directionIds: [...activeFilters.directionIds] },
    });
    setBusy(true);
    setHasSearched(true);
    setSourceOnly(mode === "sources");
    setPageError("");
    setSelectedHistory(null);
    setActiveHistoryId(null);

    setAnswer("");
    setModel("");
    const notifyFallback = createFallbackNotifier();
    setSources([]);
    setIncomplete(false);
    setElapsedMs(null);

    const abortController = new AbortController();
    activeRequest.current = abortController;
    const timeoutId = window.setTimeout(() => {
      abortController.abort(new DOMException("Analytics deadline", "TimeoutError"));
      if (token !== operation.current || receivedTerminalEvent) return;
      operation.current++;
      searchLock.current = false;
      activeRequest.current = null;
      setBusy(false);
      setAnswer("");
      setSources([]);
      setPageError(az.analytics.timeout);
      void queryClient.invalidateQueries({ queryKey: ["analytics", "history"] });
    }, ANALYTICS_CLIENT_DEADLINE_MS);
    let receivedTerminalEvent = false;
    try {
      const response = await fetch("/api/analytics/search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ query: normalizedQuestion, filters: activeFilters, mode }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string;
          requestId?: string;
        } | null;
        throw new Error(data?.message || az.analytics.searchFailed);
      }
      if (!response.body) throw new Error(az.analytics.searchFailed);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const readEvent = (frame: string) => {
        if (receivedTerminalEvent || token !== operation.current) return;
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) return;
        const event = JSON.parse(data) as {
          type: string;
          stage?: unknown;
          sources?: AnalyticsSourcePreview[];
          text?: string;
          answer?: string;
          incomplete?: boolean;
          durationMs?: number;
          message?: string;
          requestId?: string;
          model?: string;
          fallback?: ModelFallback;
        };
        if (event.type === "model-fallback" && event.fallback) notifyFallback(event.fallback);
        if (event.type === "sources") setSources(event.sources ?? []);
        if (event.type === "progress" && isAnalyticsProgressStage(event.stage))
          setStage(event.stage);
        // Generated text is published exclusively by the server-validated final event.
        if (event.type === "final") {
          receivedTerminalEvent = true;
          window.clearTimeout(timeoutId);
          searchLock.current = false;
          setBusy(false);
          setAnswer(event.answer ?? "");
          setIncomplete(Boolean(event.incomplete));
          setElapsedMs(event.durationMs ?? null);
          setModel(event.model ?? "");
        }
        if (event.type === "error") {
          receivedTerminalEvent = true;
          window.clearTimeout(timeoutId);
          searchLock.current = false;
          setBusy(false);
          setAnswer("");
          setSources([]);
          setIncomplete(false);
          setElapsedMs(null);
          setPageError(event.message || az.analytics.answerFailed);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = /\r?\n\r?\n/.exec(buffer);
        while (boundary) {
          readEvent(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
          boundary = /\r?\n\r?\n/.exec(buffer);
        }
        if (done) break;
      }
      if (buffer.trim()) readEvent(buffer);
      if (!receivedTerminalEvent && token === operation.current) {
        setAnswer("");
        setSources([]);
        setIncomplete(false);
        setElapsedMs(null);
        setPageError(az.analytics.answerFailed);
      }
    } catch (error) {
      if (receivedTerminalEvent || token !== operation.current) return;
      setAnswer("");
      setSources([]);
      setIncomplete(false);
      setElapsedMs(null);
      setPageError(
        abortController.signal.aborted
          ? abortController.signal.reason?.name === "TimeoutError"
            ? az.analytics.timeout
            : az.analytics.cancelled
          : error instanceof Error &&
              !(error instanceof TypeError) &&
              !(error instanceof SyntaxError)
            ? error.message
            : az.analytics.searchFailed,
      );
    } finally {
      window.clearTimeout(timeoutId);
      if (token === operation.current) {
        activeRequest.current = null;
        searchLock.current = false;
        setBusy(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["analytics", "history"] });
    }
  }

  async function openHistory(id: string) {
    if (historyLock.current === id) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const token = ++operation.current;
    searchLock.current = false;
    setBusy(false);
    historyLock.current = id;
    setHistoryLoading(true);
    setActiveHistoryId(id);
    setSelectedHistory(null);
    setAnswerContext(null);
    setAnswer("");
    setSources([]);
    setModel("");
    setElapsedMs(null);
    setIncomplete(false);
    setPageError("");
    setHasSearched(true);
    try {
      const record = await getAnalyticsQueryHistory({ data: { id }, signal: controller.signal });
      if (token !== operation.current) return;
      if (!record) throw new Error(az.analytics.historyOpenFailed);
      setSelectedHistory(record);
      setActiveHistoryId(record.id);
      setAnswerContext({
        query: record.query,
        filters: { ...record.filters, directionIds: [...record.filters.directionIds] },
      });
      setQuestion(record.query);
      setFilters(record.filters);
      setSources([]);
      // A fail-closed history response still exposes its authorized parent list.
      // The neutral server warning is not a generated, cited answer.
      setAnswer(
        record.status === "incomplete" && record.answer === az.analytics.sourceUnavailable
          ? ""
          : record.answer,
      );
      setIncomplete(record.status === "incomplete");
      setElapsedMs(record.durationMs);
      setModel(record.model ?? "");
      setHasSearched(true);
      setSourceOnly(false);
      setPageError("");
    } catch {
      if (token !== operation.current) return;
      // A rejected reopen is authoritative; do not keep a previously readable snapshot.
      setSelectedHistory(null);
      setAnswerContext(null);
      setAnswer("");
      setSources([]);
      setModel("");
      setElapsedMs(null);
      setIncomplete(false);
      setPageError(az.analytics.historyOpenFailed);
    } finally {
      if (token === operation.current) {
        historyLock.current = null;
        activeRequest.current = null;
        setHistoryLoading(false);
      }
    }
  }

  function cancel() {
    operation.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    searchLock.current = false;
    historyLock.current = null;
    setBusy(false);
    setHistoryLoading(false);
    setSources([]);
    setAnswer("");
    setPageError(az.analytics.cancelled);
    void queryClient.invalidateQueries({ queryKey: ["analytics", "history"] });
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
          disabled={busy || historyLoading || noDirections || question.trim().length === 0}
          type="submit"
        >
          <ZirveActionLabel
            busy={busy}
            label={az.analytics.searchButton}
            pendingLabel={az.analytics.searching}
          />
        </button>
        <button
          className="pill min-h-11 shrink-0 justify-center px-5"
          type="button"
          disabled={busy || historyLoading || noDirections || question.trim().length === 0}
          onClick={() => void runSearch("sources")}
        >
          {az.analytics.sourcesOnly}
        </button>
      </form>

      {!isNewAnalyticsFilters(filters) && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          Tarixçə: {filters.period} · Mənbə həddi: {filters.minSourceReliability} · Məlumat həddi:{" "}
          {filters.minInfoCredibility} · Bülletenlər: {filters.includeBriefs ? "ON" : "OFF"}.
          Əvvəlki filtrlər yalnız oxuma rejimindədir. Yenidən axtarış üçün yeni Dövr seçin;
          etibarlılıq seçimlərini yenidən təyin edin.
        </div>
      )}
      <FilterBar className="panel mt-3 p-3">
        <PeriodFilter
          legacyLabel={isNewAnalyticsFilters(filters) ? undefined : filters.period}
          value={isNewAnalyticsFilters(filters) ? filters : initialFilters}
          onChange={(period) =>
            setFilters((current) => ({
              ...(isNewAnalyticsFilters(current)
                ? current
                : {
                    ...initialFilters,
                    includeBriefs: current.includeBriefs,
                    directionIds: current.directionIds,
                  }),
              ...period,
              from: period.from,
              to: period.to,
            }))
          }
        />
        <div className="min-w-0 w-full sm:w-52">
          <DirectionMultiSelect
            compact
            value={filters.directionIds}
            onChange={(next) => setFilters((current) => ({ ...current, directionIds: next }))}
          />
          {noDirections && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {az.directions.required}
            </p>
          )}
        </div>
        {isNewAnalyticsFilters(filters) && (
          <ReliabilityFilters
            value={filters}
            onChange={(ratings) =>
              setFilters((current) =>
                isNewAnalyticsFilters(current)
                  ? analyticsFiltersSchema.parse({ ...current, ...ratings })
                  : current,
              )
            }
          />
        )}
        <label className="flex min-h-10 items-center gap-2 px-1 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={filters.includeBriefs}
            onChange={(event) =>
              setFilters((current) => ({ ...current, includeBriefs: event.target.checked }))
            }
          />
          {az.analytics.includeBriefs}
        </label>
        {isNewAnalyticsFilters(filters) &&
          (filters.sourceReliabilities.length > 0 ||
            filters.infoCredibilities.length > 0 ||
            filters.directionIds.length !== directionIds.length) && (
            <button
              type="button"
              className="min-h-10 px-2 text-xs text-muted-foreground underline underline-offset-4"
              onClick={() =>
                setFilters((current) =>
                  isNewAnalyticsFilters(current)
                    ? {
                        ...current,
                        sourceReliabilities: [],
                        infoCredibilities: [],
                        directionIds: [...directionIds],
                      }
                    : current,
                )
              }
            >
              Əlavə filtrləri təmizlə
            </button>
          )}
      </FilterBar>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Sənədin tarixi yoxdursa, əlavə edilmə tarixi üzrə süzülür.
      </p>

      {pageError && (
        <div role="alert" className="mt-4 rounded-xl border border-destructive/40 p-4 text-sm">
          {pageError}
          <button
            type="button"
            className="ml-3 min-h-11 underline"
            onClick={() =>
              activeHistoryId
                ? void openHistory(activeHistoryId)
                : answerContext
                  ? void runSearch(sourceOnly ? "sources" : "answer", answerContext)
                  : void runSearch("answer")
            }
          >
            {az.actions.retry}
          </button>
        </div>
      )}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          {/* Let stage announcements through while the analytical operation is running. */}
          <section className="panel panel-glow h-fit px-4 py-5 sm:p-7" aria-busy={historyLoading}>
            <div className="mx-auto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {displayedQuestion && (
                  <h2 className="text-xl leading-snug font-semibold tracking-tight break-words sm:text-2xl">
                    {displayedQuestion}
                  </h2>
                )}

                <span className="label-mono">
                  {busy
                    ? null
                    : historyLoading
                      ? az.analytics.historyLoading
                      : elapsedMs === null
                        ? hasSearched
                          ? sourceCountLabel
                          : az.analytics.waiting
                        : az.analytics.timing.replace("{seconds}", (elapsedMs / 1000).toFixed(1))}
                </span>
              </div>
              {hasSearched && !busy && answer && (
                <p className="mt-2 text-xs text-muted-foreground">{sourceCountLabel}</p>
              )}
              {(busy || historyLoading) && (
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-secondary"
                  onClick={cancel}
                >
                  <Square size={13} aria-hidden="true" />
                  {az.analytics.cancel}
                </button>
              )}
              {incomplete && (
                <p className="mt-4 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-700">
                  {az.analytics.incompleteAnswer}
                </p>
              )}
              <div aria-live="polite" className="mt-4">
                {historyLoading ? (
                  <ZirveSkeleton
                    label={az.analytics.historyLoading}
                    rows={5}
                    className="min-h-48"
                  />
                ) : answer ? (
                  <AnalyticsAnswer
                    navigationScope={navigationScope}
                    answer={answer}
                    sources={
                      selectedHistory?.sources ??
                      sources.map((source) => ({ ...source, preview: source }))
                    }
                    model={sourceOnly ? undefined : model}
                    busy={busy || historyLoading}
                    onRegenerate={
                      answerContext ? () => void runSearch("answer", answerContext) : undefined
                    }
                  />
                ) : busy ? (
                  <AnalyticsProgress stage={stage} sourceOnly={sourceOnly} />
                ) : (sourceOnly || selectedHistory) && shownGroups.length > 0 ? (
                  <p className="text-muted-foreground">{az.analytics.fragmentsOnly}</p>
                ) : selectedHistory?.status === "running" ? (
                  <p className="text-muted-foreground">{az.analytics.historyRunningBody}</p>
                ) : pageError ? null : hasSearched ? (
                  <p className="text-muted-foreground">{az.analytics.noSources}</p>
                ) : (
                  <p className="text-muted-foreground">{az.analytics.emptyState}</p>
                )}
              </div>
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="label-mono">{az.analytics.sources}</p>
              {hasSearched && (!busy || sourceOnly) ? (
                <span className="label-mono">{sourceListCountLabel}</span>
              ) : null}
            </div>

            <div className="space-y-3">
              {shownGroups.map((group) => (
                <AnalyticsSourceCard
                  key={group.key}
                  group={group}
                  navigationScope={navigationScope}
                  fragmentLabel={shownFragmentLabel.replace(
                    "{count}",
                    String(group.displayedChunkCount),
                  )}
                  openLabel={group.sourceKind === "brief" ? "brief" : "document"}
                />
              ))}
              {unavailableSources.map((source) => (
                <article
                  key={`unavailable-${source.n}`}
                  className="panel p-5 text-sm text-muted-foreground"
                >
                  [{source.n}] {az.analytics.sourceUnavailable}
                </article>
              ))}
              {hasSearched &&
                shownGroups.length === 0 &&
                unavailableSources.length === 0 &&
                !busy &&
                !historyLoading &&
                selectedHistory?.status !== "running" &&
                !pageError && (
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
          <section className="panel p-3 xl:sticky xl:top-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 flex-1">
                <button
                  type="button"
                  className="label-mono flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-secondary"
                  aria-expanded={historyExpanded}
                  aria-controls="analytics-history"
                  onClick={() => setHistoryExpanded((current) => !current)}
                >
                  <History size={15} aria-hidden="true" />
                  {az.analytics.historyTitle}
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className={
                      "ml-auto transition-transform " + (historyExpanded ? "" : "-rotate-90")
                    }
                  />
                </button>
              </h2>
              {historyQuery.isFetching && <ZirveLoader variant="inline" label="" />}
            </div>
            <div id="analytics-history" hidden={!historyExpanded}>
              {historyQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {az.analytics.historyFailed}
                  <button
                    type="button"
                    className="min-h-11 px-2 underline"
                    onClick={() => void historyQuery.refetch()}
                  >
                    {az.actions.retry}
                  </button>
                </p>
              ) : historyQuery.isPending ? (
                <ZirveSkeleton label={az.loader.loading} />
              ) : historyQuery.data?.length ? (
                <div className="analytics-history max-h-72 space-y-1 overflow-y-auto pr-1 xl:max-h-[65vh]">
                  {historyQuery.data.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        "w-full rounded-lg border p-2.5 text-left transition-colors hover:border-primary/40 disabled:opacity-60 " +
                        (activeHistoryId === item.id
                          ? "border-primary/30 bg-accent"
                          : "border-transparent hover:bg-secondary")
                      }
                      aria-current={activeHistoryId === item.id ? "true" : undefined}
                      aria-busy={historyLoading && activeHistoryId === item.id}
                      onClick={() => void openHistory(item.id)}
                    >
                      <span className="block line-clamp-2 text-sm font-medium">{item.query}</span>
                      <span className="label-mono mt-1 block">
                        {historyLoading && activeHistoryId === item.id
                          ? az.analytics.historyLoading
                          : historyStatusLabel(item.status)}
                        {item.author ? ` · ${item.author}` : ""}
                        {` · ${new Date(item.createdAt).toLocaleString("az-AZ")}`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{az.analytics.historyEmpty}</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
