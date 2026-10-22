import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

import { ClassificationBadge } from "./ClassificationBadge";
import {
  analyticsFragmentAnchor,
  analyticsFragmentId,
  analyticsSourceKind,
  navigateToAnalyticsFragment,
  type AnalyticsSourceGroup,
  type AnalyticsSourcePreview,
} from "@/lib/analytics";
import { briefRouteForSearchSource } from "@/lib/briefs";
import { directionLabel } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import { defaultInfoCredibility, defaultSourceReliability } from "@/lib/reliability";

/**
 * One card per unique parent material (document or brief). Chunk-level citations
 * inside keep their original numbers; each fragment is addressable by
 * `#fragment-<group key>-<n>` so in-text citations and "Mənbə kartı" land on it.
 */
export function AnalyticsSourceCard({
  group,
  fragmentLabel,
  navigationScope = "",
}: {
  group: AnalyticsSourceGroup;
  /** `tapılmış` for sources-only, `istinad edilmiş` for answer mode. */
  fragmentLabel: string;
  openLabel: "document" | "brief";
  navigationScope?: string | undefined;
}) {
  const head = group.chunks[0];
  const multi = group.chunks.length > 1;
  const [expanded, setExpanded] = useState(false);
  const article = useRef<HTMLElement>(null);
  const numbers = group.citedNumbers;
  const resolvedOpenLabel = group.sourceKind;
  const fragmentsId = `${analyticsFragmentId(group.key, 0, navigationScope)}-list`;
  const titleId = `${analyticsFragmentId(group.key, 0, navigationScope)}-title`;
  const fragmentIds = group.citedNumbers
    .map((n) => analyticsFragmentId(group.key, n, navigationScope))
    .join("\0");

  // Deep links into a collapsed card open it, then land on the exact fragment.
  useEffect(() => {
    let timer: number | undefined;
    const openFromHash = () => {
      let targetId: string;
      try {
        targetId = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!fragmentIds.split("\0").includes(targetId)) return;
      setExpanded(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const target = document.getElementById(targetId);
        if (!target || !article.current?.contains(target)) return;
        target.scrollIntoView?.({ block: "center" });
        target.focus({ preventScroll: true });
      }, 0);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      clearTimeout(timer);
    };
  }, [fragmentIds]);

  return (
    <article
      ref={article}
      id={`${navigationScope ? `${navigationScope}-` : ""}source-${group.citedNumbers[0] ?? ""}`}
      data-source-group={group.key}
      className="panel scroll-mt-24 p-4 sm:p-5"
      aria-labelledby={titleId}
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <h3 id={titleId} className="font-semibold break-words [overflow-wrap:anywhere]">
            {head?.title || az.analytics.sourceUnavailable}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">
              {group.sourceKind === "brief"
                ? az.analytics.materialBrief
                : az.analytics.materialDocument}
            </span>
            <span>{head?.docDate ?? head?.briefDate}</span>
            {head?.classification && <ClassificationBadge classification={head.classification} />}
          </div>
          {group.sourceKind === "document" && head && (
            <p className="label-mono mt-2">
              {directionLabel(head.direction) ?? az.directions.unassigned}
            </p>
          )}
        </div>
        {group.sourceKind === "document" && head && (
          <ReliabilityBadges
            sourceReliability={head.sourceReliability}
            infoCredibility={head.infoCredibility}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {fragmentLabel.replace("{count}", String(group.displayedChunkCount))}
        </p>
        <p
          className="flex flex-wrap items-center gap-1"
          aria-label={az.analytics.materialCitationNumbers.replace(
            "{numbers}",
            numbers.map((n) => String(n)).join(", "),
          )}
        >
          {numbers.map((n) => (
            <a
              key={n}
              className="cite "
              href={analyticsFragmentAnchor(group.key, n, navigationScope)}
              aria-label={az.analytics.openSource.replace("{n}", String(n))}
              onClick={(event) => {
                event.preventDefault();
                navigateToAnalyticsFragment(analyticsFragmentAnchor(group.key, n, navigationScope));
              }}
            >
              [{n}]
            </a>
          ))}
        </p>
        {multi && (
          <button
            type="button"
            className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2"
            aria-expanded={expanded}
            aria-controls={fragmentsId}
            onClick={() => setExpanded((current) => !current)}
          >
            {az.analytics.toggleFragments}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={"transition-transform " + (expanded ? "" : "-rotate-90")}
            />
          </button>
        )}
      </div>

      <ul
        id={fragmentsId}
        hidden={multi && !expanded}
        className="mt-2 divide-y divide-border/60 border-t border-border/60"
      >
        {group.chunks.map((chunk) => (
          <FragmentRow
            key={chunk.chunkId || chunk.n}
            chunk={chunk}
            groupKey={group.key}
            numbers={numbers.filter((n) => group.citationChunks.get(n) === chunk)}
            navigationScope={navigationScope}
          />
        ))}
      </ul>

      {head && <SourceLinks head={head} openLabel={resolvedOpenLabel} />}
    </article>
  );
}

function FragmentRow({
  chunk,
  groupKey,
  numbers,
  navigationScope,
}: {
  chunk: AnalyticsSourcePreview;
  groupKey: string;
  numbers: number[];
  navigationScope: string;
}) {
  const href = chunkRoute(chunk);
  return (
    <li
      id={analyticsFragmentId(groupKey, chunk.n, navigationScope)}
      tabIndex={-1}
      className="scroll-mt-24 py-3 focus-visible:outline-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {numbers.map((n) => (
          <span
            key={n}
            id={n === chunk.n ? undefined : analyticsFragmentId(groupKey, n, navigationScope)}
            tabIndex={n === chunk.n ? undefined : -1}
            className="cite ml-0! scroll-mt-24 focus-visible:outline-2"
          >
            [{n}]
          </span>
        ))}
        {chunk.sectionTitle && (
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{chunk.sectionTitle}</span>
        )}
        {chunk.isTable && <span>· {az.analytics.table}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-start gap-x-3 gap-y-1">
        {chunk.quote && (
          <p className="min-w-0 flex-1 text-sm leading-relaxed [overflow-wrap:anywhere]">
            «{chunk.quote}»
          </p>
        )}
        {href && (
          <a
            className="inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline focus-visible:outline-2"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={az.analytics.openFragment}
          >
            {az.analytics.fragmentLabel} →
          </a>
        )}
      </div>
    </li>
  );
}

/** Chunk-scoped route when known, otherwise the material itself (legacy history). */
function chunkRoute(source: AnalyticsSourcePreview): string | null {
  if (source.chunkId) {
    const scoped = briefRouteForSearchSource({
      ...source,
      sourceKind: analyticsSourceKind(source),
    });
    if (scoped) return scoped;
  }
  if (analyticsSourceKind(source) === "brief")
    return source.briefId ? `/brifler/${encodeURIComponent(source.briefId)}` : null;
  return source.documentId ? `/senedler/${encodeURIComponent(source.documentId)}` : null;
}

function SourceLinks({
  head,
  openLabel,
}: {
  head: AnalyticsSourcePreview;
  openLabel: "document" | "brief";
}) {
  // History entries without a resolved chunk (legacy/partial access) open the material itself.
  const href = chunkRoute(head);
  if (!href) return null;
  return (
    <a
      className="pill mt-3 inline-flex min-h-10 items-center"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={openLabel === "brief" ? az.analytics.openBrief : az.analytics.openDocument}
    >
      {openLabel === "brief" ? az.analytics.openBrief : az.analytics.openDocument}
      {head.attachmentCount > 0 ? " · " + head.attachmentCount + " " + az.analytics.photos : ""}
      <ExternalLink size={12} className="ml-1.5" aria-hidden="true" />
    </a>
  );
}

function ReliabilityBadges({
  sourceReliability,
  infoCredibility,
}: {
  sourceReliability: AnalyticsSourcePreview["sourceReliability"];
  infoCredibility: AnalyticsSourcePreview["infoCredibility"];
}) {
  if (sourceReliability == null && infoCredibility == null)
    return <span className="label-mono">{az.analytics.unrated}</span>;
  const sourceLabel = az.reliability.sourceBadge + " " + sourceReliability;
  const infoLabel = az.reliability.informationBadge + " " + infoCredibility;
  return (
    <div className="flex flex-wrap gap-1.5">
      {sourceReliability != null && (
        <span
          className={
            "label-mono rounded-full border px-2 py-1 " +
            (sourceReliability === defaultSourceReliability
              ? "border-border text-muted-foreground/60"
              : "border-primary/30 text-primary")
          }
          tabIndex={0}
          title={az.reliability.source[sourceReliability]}
          aria-label={sourceLabel + ": " + az.reliability.source[sourceReliability]}
        >
          {sourceLabel}
        </span>
      )}
      {infoCredibility != null && (
        <span
          className={
            "label-mono rounded-full border px-2 py-1 " +
            (infoCredibility === defaultInfoCredibility
              ? "border-border text-muted-foreground/60"
              : "border-primary/30 text-primary")
          }
          tabIndex={0}
          title={az.reliability.information[infoCredibility]}
          aria-label={infoLabel + ": " + az.reliability.information[infoCredibility]}
        >
          {infoLabel}
        </span>
      )}
    </div>
  );
}
