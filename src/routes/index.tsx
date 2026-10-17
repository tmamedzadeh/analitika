import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Shell } from "@/components/Shell";
import type { AnalyticsFilters, AnalyticsSourcePreview } from "@/lib/analytics";
import { getAnalyticsOptions } from "@/lib/analytics.functions";
import { az } from "@/lib/i18n/az";
import { infoCredibilityValues, sourceReliabilityValues } from "@/lib/reliability";

const initialFilters: AnalyticsFilters = {
  period: "12m",
  tag: "",
  documentId: "",
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Analitika üzrə axtarış" },
      { name: "description", content: "Sənədlər üzrə mənbəli analitik axtarış və sintez." },
      { property: "og:title", content: "Analitika üzrə axtarış" },
      { property: "og:description", content: "Sənədlər üzrə mənbəli analitik axtarış və sintez." },
    ],
  }),
  component: Analytics,
});

function sourceUrl(source: AnalyticsSourcePreview): string {
  return "/senedler/" + source.documentId + "?chunk=" + encodeURIComponent(source.chunkId);
}

function inlineAnswer(answer: string, sources: AnalyticsSourcePreview[]) {
  return answer.split(/(\[\d+\])/g).map((part, index) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (!match) return <span key={index}>{part}</span>;
    const source = sources.find((candidate) => candidate.n === Number(match[1]));
    return source ? (
      <a
        key={index}
        className="cite"
        href={sourceUrl(source)}
        aria-label={az.analytics.openSource.replace("{n}", String(source.n))}
      >
        {match[1]}
      </a>
    ) : (
      <span key={index} className="cite">
        {match[1]}
      </span>
    );
  });
}

function ReliabilityBadges({ source }: { source: AnalyticsSourcePreview }) {
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
  const [question, setQuestion] = useState("");
  const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters);
  const [sources, setSources] = useState<AnalyticsSourcePreview[]>([]);
  const [answer, setAnswer] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [sourceOnly, setSourceOnly] = useState(false);

  const optionsQuery = useQuery({
    queryKey: ["analytics", "options"],
    queryFn: () => getAnalyticsOptions(),
  });

  async function runSearch(mode: "answer" | "sources") {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || busy) return;
    setBusy(true);
    setHasSearched(true);
    setSourceOnly(mode === "sources");
    setPageError("");
    setAnswer("");
    setSources([]);
    setIncomplete(false);
    setElapsedMs(null);

    try {
      const response = await fetch("/api/analytics/search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ query: normalizedQuestion, filters, mode }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message || az.analytics.searchFailed);
      }
      if (!response.body) throw new Error(az.analytics.searchFailed);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
        };
        if (event.type === "sources") setSources(event.sources ?? []);
        if (event.type === "delta") setAnswer((current) => current + (event.text ?? ""));
        if (event.type === "final") {
          setAnswer(event.answer ?? "");
          setIncomplete(Boolean(event.incomplete));
          setElapsedMs(event.durationMs ?? null);
        }
        if (event.type === "error") setPageError(event.message || az.analytics.answerFailed);
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
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.analytics.searchFailed);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch("answer");
  }

  return (
    <Shell
      crumb={az.analytics.crumb}
      title={az.analytics.title}
      badges={[az.analytics.systemReady, az.analytics.modelBadge]}
    >
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
          disabled={busy || question.trim().length === 0}
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
            <option value="12m">{az.analytics.period12m}</option>
            <option value="30d">{az.analytics.period30d}</option>
            <option value="all">{az.analytics.all}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>{az.analytics.tagLabel}</span>
          <select
            className="field"
            value={filters.tag}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setFilters((current) => ({ ...current, tag: value }));
            }}
          >
            <option value="">{az.analytics.all}</option>
            {(optionsQuery.data?.tags ?? []).map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>{az.analytics.documentLabel}</span>
          <select
            className="field"
            value={filters.documentId}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setFilters((current) => ({ ...current, documentId: value }));
            }}
          >
            <option value="">{az.analytics.all}</option>
            {(optionsQuery.data?.documents ?? []).map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>{az.analytics.sourceReliabilityFilter}</span>
          <select
            className="field"
            value={filters.minSourceReliability}
            onChange={(event) => {
              const value = event.currentTarget.value as AnalyticsFilters["minSourceReliability"];
              setFilters((current) => ({
                ...current,
                minSourceReliability: value,
              }));
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
          <span>{az.analytics.infoReliabilityFilter}</span>
          <select
            className="field"
            value={filters.minInfoCredibility}
            onChange={(event) => {
              const value = event.currentTarget.value as AnalyticsFilters["minInfoCredibility"];
              setFilters((current) => ({
                ...current,
                minInfoCredibility: value,
              }));
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

      {pageError && (
        <div role="alert" className="mt-4 rounded-xl border border-destructive/40 p-4 text-sm">
          {pageError}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_352px]">
        <section className="panel h-fit p-6">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="label-mono !text-primary">{az.analytics.synthesis}</span>
            <span className="label-mono">
              {elapsedMs === null
                ? busy
                  ? az.analytics.generating
                  : hasSearched
                    ? az.analytics.sourcesCount.replace("{count}", String(sources.length))
                    : az.analytics.waiting
                : az.analytics.timing
                    .replace("{seconds}", (elapsedMs / 1000).toFixed(1))
                    .replace("{count}", String(sources.length))}
            </span>
          </div>
          {incomplete && (
            <p className="mt-4 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-700">
              {az.analytics.incompleteAnswer}
            </p>
          )}
          <div aria-live="polite" className="mt-4 whitespace-pre-wrap">
            {answer ? (
              inlineAnswer(answer, sources)
            ) : busy ? (
              <p className="text-muted-foreground">{az.analytics.generating}</p>
            ) : sourceOnly && sources.length > 0 ? (
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
              disabled={!hasSearched || busy}
              onClick={() => void runSearch("sources")}
            >
              {az.analytics.showOnlyFragments}
            </button>
            <button
              className="pill disabled:opacity-50"
              type="button"
              disabled={!hasSearched || busy || question.trim().length === 0}
              onClick={() => void runSearch("answer")}
            >
              {az.analytics.regenerate}
            </button>
          </div>
        </section>

        <aside>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="label-mono">{az.analytics.sources}</p>
            <span className="label-mono">
              {hasSearched
                ? az.analytics.sourcesCount.replace("{count}", String(sources.length))
                : ""}
            </span>
          </div>
          {optionsQuery.isError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {az.analytics.optionsFailed}
            </p>
          )}
          <div className="space-y-3">
            {sources.map((source) => (
              <article key={source.chunkId} className="panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">
                    <span className="cite !ml-0 mr-1">{source.n}</span>
                    {source.title}
                  </h3>
                  <ReliabilityBadges source={source} />
                </div>
                <p className="label-mono mt-2">
                  {[source.sectionTitle || az.analytics.sectionUnknown, source.docDate]
                    .filter(Boolean)
                    .join(" · ")}
                  {source.isTable ? " · " + az.analytics.table : ""}
                </p>
                {source.quote && <p className="mt-2 text-sm">«{source.quote}»</p>}
                <a className="pill mt-3 inline-flex" href={sourceUrl(source)}>
                  {az.analytics.openDocument}
                  {source.attachmentCount > 0
                    ? " · " + source.attachmentCount + " " + az.analytics.photos
                    : ""}
                </a>
              </article>
            ))}
            {hasSearched && sources.length === 0 && !busy && (
              <div className="panel p-5 text-sm text-muted-foreground">
                {az.analytics.noSources}
              </div>
            )}
            {!hasSearched && !optionsQuery.isLoading && (
              <div className="panel p-5 text-sm text-muted-foreground">
                {az.analytics.sourcesHint}
              </div>
            )}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
