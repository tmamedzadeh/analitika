import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  analyticsFragmentAnchor,
  navigateToAnalyticsFragment,
  type AnalyticsSourceGroupKey,
  type AnalyticsSourcePreview,
} from "@/lib/analytics";
import { briefRouteForSearchSource } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export type AnalyticsCitationSource = {
  n: number;
  available?: boolean;
  title?: string;
  caption?: string;
  documentId?: string | null;
  briefId?: string | null;
  chunkId?: string | null | undefined;
  sourceKind?: "document" | "brief";
  preview?: AnalyticsSourcePreview | null;
};

export function AnalyticsCitation({
  source,
  groupKey,
  navigationScope = "",
}: {
  source: AnalyticsCitationSource;
  /** Grouped source card this chunk belongs to, when known. */
  groupKey?: AnalyticsSourceGroupKey | undefined;
  navigationScope?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const hovering = useRef(false);
  const navigating = useRef(false);
  const restoringFocus = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepOpen = () => clearTimeout(closeTimer.current);
  const closeHover = () => {
    if (hovering.current) closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const preview = source.preview;
  const title = preview?.title ?? source.title;
  const section = preview?.sectionTitle ?? source.caption;
  const date = preview?.docDate ?? preview?.briefDate;
  const href = preview
    ? briefRouteForSearchSource(preview)
    : source.documentId
      ? `/senedler/${encodeURIComponent(source.documentId)}`
      : source.briefId
        ? `/brifler/${encodeURIComponent(source.briefId)}`
        : null;
  const label = az.analytics.openSource.replace("{n}", String(source.n));
  // In-text citation anchor, kept for compatibility with existing deep links.
  const citationAnchor = `#${encodeURIComponent(`${navigationScope ? `${navigationScope}-` : ""}source-${source.n}`)}`;
  const fragmentAnchor = groupKey
    ? analyticsFragmentAnchor(groupKey, source.n, navigationScope)
    : citationAnchor;

  if (source.available === false) return <span className="cite">[{source.n}]</span>;
  if (!title)
    return (
      <a
        className="cite"
        href={fragmentAnchor}
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          navigateToAnalyticsFragment(fragmentAnchor);
        }}
      >
        [{source.n}]
      </a>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <a
          className="cite"
          href={fragmentAnchor}
          aria-label={label}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              keepOpen();
              hovering.current = true;
              setOpen(true);
            }
          }}
          onPointerLeave={closeHover}
          onFocus={() => {
            if (restoringFocus.current) return;
            hovering.current = false;
            keepOpen();
            setOpen(true);
          }}
          onClick={(event) => {
            event.preventDefault();
            hovering.current = false;
            keepOpen();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            hovering.current = false;
            keepOpen();
            setOpen(true);
            window.setTimeout(() => content.current?.querySelector("a")?.focus(), 0);
          }}
        >
          [{source.n}]
        </a>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-4 text-sm"
        align="start"
        onPointerEnter={keepOpen}
        onPointerLeave={closeHover}
        onFocusCapture={() => {
          hovering.current = false;
          keepOpen();
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (hovering.current || navigating.current) event.preventDefault();
          restoringFocus.current = true;
          queueMicrotask(() => {
            restoringFocus.current = false;
          });
          navigating.current = false;
          hovering.current = false;
        }}
      >
        <p className="font-semibold break-words [overflow-wrap:anywhere]">
          [{source.n}] {title}
        </p>
        <p className="mt-1 text-xs break-words text-muted-foreground [overflow-wrap:anywhere]">
          {[date, section].filter(Boolean).join(" · ") || az.analytics.sectionUnknown}
        </p>
        <p className="mt-3 line-clamp-5 leading-relaxed break-words text-muted-foreground [overflow-wrap:anywhere]">
          {preview?.quote || az.analytics.previewUnavailable}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium">
          {href && (
            <a
              className="inline-flex min-h-9 items-center gap-1.5 text-primary hover:underline focus-visible:outline-2"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {az.analytics.openFullSource}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
          <a
            className="inline-flex min-h-9 items-center text-muted-foreground hover:text-foreground"
            href={fragmentAnchor}
            onClick={(event) => {
              event.preventDefault();
              navigating.current = true;
              setOpen(false);
              navigateToAnalyticsFragment(fragmentAnchor);
            }}
          >
            {az.analytics.sourceCard}
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
