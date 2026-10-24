import { BriefMarkdown } from "./BriefMarkdown";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { AnalyticsCitation, type AnalyticsCitationSource } from "./AnalyticsCitation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { az } from "@/lib/i18n/az";
import { modelDisplayName } from "@/lib/ai";
import { analyticsSourceGroupKey } from "@/lib/analytics";
import { analyticsCitedNumbers, remarkAnalyticsCitations } from "@/lib/analytics-citations";
import { isLowReliability } from "@/lib/reliability";

export function AnalyticsAnswer({
  answer,
  sources,
  model,
  onRegenerate,
  busy = false,
  navigationScope,
  displayNumbers,
}: {
  answer: string;
  sources: readonly AnalyticsCitationSource[];
  model?: string | null | undefined;
  onRegenerate?: (() => void) | undefined;
  busy?: boolean;
  navigationScope?: string | undefined;
  displayNumbers?: ReadonlyMap<number, number> | undefined;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copying = useRef(false);
  useEffect(() => {
    setCopyState("idle");
  }, [answer]);
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  async function copy() {
    if (copying.current) return;
    copying.current = true;
    try {
      // Copy the complete answer Markdown, preserving paragraphs, tables and [n].
      await navigator.clipboard.writeText(answer);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      copying.current = false;
    }
  }
  const cited = analyticsCitedNumbers(answer);
  const weakSources = sources.filter(
    (source) =>
      source.available !== false &&
      cited.has(source.n) &&
      source.preview &&
      isLowReliability(source.preview.sourceReliability, source.preview.infoCredibility),
  );
  return (
    <div className="analytics-answer">
      <BriefMarkdown
        markdown={answer}
        remarkPlugins={[remarkAnalyticsCitations]}
        linkRenderer={(href, children, node) => {
          const match = /^#citation-(\d+)$/u.exec(href ?? "");
          if (
            !match ||
            children !== match[1] ||
            node?.properties["data-analytics-citation"] !== true
          )
            return <>{children}</>;
          const candidates = sources.filter((candidate) => candidate.n === Number(match[1]));
          const source =
            candidates.length === 1 && candidates[0]?.available !== false
              ? candidates[0]
              : undefined;
          return source ? (
            <AnalyticsCitation
              source={source}
              displayN={displayNumbers?.get(source.n)}
              groupKey={
                source.preview || source.documentId || source.briefId || source.chunkId
                  ? analyticsSourceGroupKey({ ...source, ...source.preview, n: source.n })
                  : undefined
              }
              navigationScope={navigationScope}
            />
          ) : (
            <span className="cite">[{children}]</span>
          );
        }}
      />
      {weakSources.length > 0 && (
        <aside
          className="mt-6 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm"
          aria-label={az.analytics.reliabilityLimitations}
        >
          <p className="font-medium">{az.analytics.reliabilityLimitations}</p>
          <p className="mt-1 text-muted-foreground">{az.analytics.ratedSourceCaution}</p>
          <ul className="mt-2 space-y-1">
            {weakSources.map((source) => (
              <li key={source.n}>
                [{displayNumbers?.get(source.n) ?? source.n}] {source.preview!.title} ·{" "}
                {source.preview!.sourceReliability ?? az.analytics.unrated} /{" "}
                {source.preview!.infoCredibility ?? az.analytics.unrated}
              </li>
            ))}
          </ul>
        </aside>
      )}
      {answer && (
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <div className="flex items-center gap-1">
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="analytics-action"
                    aria-label={az.analytics.copy}
                    disabled={busy}
                    onClick={() => void copy()}
                  >
                    {copyState === "copied" ? (
                      <Check size={17} aria-hidden="true" />
                    ) : (
                      <Copy size={17} aria-hidden="true" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {copyState === "copied" ? az.analytics.copied : az.analytics.copy}
                </TooltipContent>
              </Tooltip>
              {onRegenerate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="analytics-action"
                      aria-label={az.analytics.regenerate}
                      disabled={busy}
                      onClick={onRegenerate}
                    >
                      <RefreshCw
                        size={17}
                        aria-hidden="true"
                        className={busy ? "animate-spin" : undefined}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{az.analytics.regenerate}</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
            <span role="status" className="ml-1 text-xs text-muted-foreground">
              {copyState === "copied"
                ? az.analytics.copied
                : copyState === "failed"
                  ? az.analytics.copyFailed
                  : ""}
            </span>
          </div>
          {model && answer !== az.analytics.noSources && (
            <p className="text-xs text-muted-foreground">
              {az.ai.generatedBy.replace("{model}", modelDisplayName(model))}
            </p>
          )}
        </footer>
      )}
    </div>
  );
}
