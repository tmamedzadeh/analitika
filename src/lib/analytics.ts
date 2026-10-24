import { z } from "zod";
import { periodShape, resolvePeriod } from "./period";
import { sourceReliabilityValues } from "./reliability";

import type { InfoCredibility, SourceReliability } from "./reliability";
import { directionIdSchema, directionIds } from "./directions";

// Leave time for the terminal SSE event within Vercel's 300s function limit.
export const ANALYTICS_SERVER_DEADLINE_MS = 240_000;
export const ANALYTICS_CLIENT_DEADLINE_MS = 255_000;

export const analyticsProgressStages = [
  "starting",
  "retrieval",
  "sources",
  "generation",
  "validation",
] as const;
export type AnalyticsProgressStage = (typeof analyticsProgressStages)[number];

export function isAnalyticsProgressStage(value: unknown): value is AnalyticsProgressStage {
  return typeof value === "string" && analyticsProgressStages.some((stage) => stage === value);
}

export function citedSourceNumbers(answer: string): Set<number> {
  return new Set([...answer.matchAll(/\[(\d+)\]/gu)].map((match) => Number(match[1])));
}

export const legacyAnalyticsFiltersSchema = z.object({
  includeBriefs: z.boolean().default(false),
  period: z.enum(["7d", "30d", "90d", "12m", "all"]),
  directionIds: z
    .array(directionIdSchema)
    .min(1)
    .max(directionIds.length)
    .refine((values) => new Set(values).size === values.length),
  minSourceReliability: z.enum(["all", "A", "B", "C", "D", "E", "F"]),
  minInfoCredibility: z.enum(["all", "1", "2", "3", "4", "5", "6"]),
});

export const reliabilityFilterShape = {
  sourceReliabilities: z
    .array(z.enum(sourceReliabilityValues))
    .max(5)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
  infoCredibilities: z
    .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]))
    .max(5)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
};
export const analyticsFiltersSchema = z
  .object({
    ...periodShape,
    ...reliabilityFilterShape,
    filterVersion: z.literal(2).default(2),
    includeBriefs: z.boolean().default(true),
    directionIds: legacyAnalyticsFiltersSchema.shape.directionIds,
    minSourceReliability: z.literal("all").default("all"),
    minInfoCredibility: z.literal("all").default("all"),
  })
  .superRefine((value, ctx) => {
    try {
      resolvePeriod(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period"],
        message: (error as Error).message,
      });
    }
  });
export type NewAnalyticsFilters = z.infer<typeof analyticsFiltersSchema>;
export type LegacyAnalyticsFilters = z.infer<typeof legacyAnalyticsFiltersSchema>;
export type AnalyticsFilters = NewAnalyticsFilters | LegacyAnalyticsFilters;
/** Never apply defaults for new requests to saved legacy snapshots. */
export function parseHistoryFilters(value: unknown) {
  return value && typeof value === "object" && "filterVersion" in value && value.filterVersion === 2
    ? analyticsFiltersSchema.safeParse(value)
    : legacyAnalyticsFiltersSchema.safeParse(value);
}
export function isNewAnalyticsFilters(value: AnalyticsFilters): value is NewAnalyticsFilters {
  return "filterVersion" in value && value.filterVersion === 2;
}
export const analyticsSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  filters: analyticsFiltersSchema,
  mode: z.enum(["answer", "sources"]),
});
export type AnalyticsSearchRequest = z.infer<typeof analyticsSearchRequestSchema>;

export type AnalyticsSource = {
  sourceKind: "document" | "brief";
  n: number;
  chunkId: string;
  documentId: string | null;
  briefId: string | null;
  title: string;
  docDate: string | null;
  briefDate: string | null;
  direction: string | null;
  sectionTitle: string;
  text: string;
  quote: string;
  charStart: number;
  charEnd: number;
  isTable: boolean;
  attachmentCount: number;
  sourceReliability: SourceReliability | null;
  infoCredibility: InfoCredibility | null;
  classification: string | null;
};

export type AnalyticsSourcePreview = Omit<AnalyticsSource, "text" | "charStart" | "charEnd">;

/** Display-only grouping key: one source card per unique parent material. */
export type AnalyticsSourceGroupKey = `document:${string}` | `brief:${string}` | `chunk:${string}`;

type GroupableSource = {
  n: number;
  chunkId?: string | null | undefined;
  documentId?: string | null | undefined;
  briefId?: string | null | undefined;
  sourceKind?: "document" | "brief" | undefined;
};

/** Older authorized history mappings may omit the material type. */
export function analyticsSourceKind(source: GroupableSource): "document" | "brief" {
  return (
    source.sourceKind ?? (source.documentId ? "document" : source.briefId ? "brief" : "document")
  );
}

/**
 * Stable identity of the parent material. Never derived from title, date or text.
 * Documents and briefs never merge, even with identical IDs. Sources without a
 * usable parent ID stay in their own single-chunk group.
 */
export function analyticsSourceGroupKey(source: GroupableSource): AnalyticsSourceGroupKey {
  // A brief and a document never share a group, even with an identical UUID.
  const kind = analyticsSourceKind(source);
  if (kind === "brief" && source.briefId) return `brief:${source.briefId}`;
  if (kind === "document" && source.documentId) return `document:${source.documentId}`;
  return `chunk:${kind}:${source.chunkId || `n:${source.n}`}`;
}

export type AnalyticsSourceGroup<S extends GroupableSource = AnalyticsSourcePreview> = {
  key: AnalyticsSourceGroupKey;
  sourceKind: "document" | "brief";
  documentId: string | null;
  briefId: string | null;
  /** Member chunks in retrieval order; each cited chunk appears once. */
  chunks: S[];
  /** Citation numbers used in the answer that this group owns, ascending. */
  citedNumbers: number[];
  /** Original citation numbers, including aliases, mapped to the displayed chunk. */
  citationChunks: Map<number, S>;
  /** Chunk count that should be displayed for this group. */
  displayedChunkCount: number;
};

/**
 * Groups sources by parent material while keeping chunk-level numbering intact.
 * With `cited` supplied, only cited chunks and numbers are counted (answer mode);
 * without it every supplied (retrieved) chunk is counted (sources-only mode).
 */
export function groupAnalyticsSources<S extends GroupableSource>(
  sources: readonly S[],
  cited?: ReadonlySet<number>,
): AnalyticsSourceGroup<S>[] {
  const groups = new Map<AnalyticsSourceGroupKey, AnalyticsSourceGroup<S>>();
  const seenChunks = new Map<AnalyticsSourceGroupKey, Map<string, S>>();
  const seenNumbers = new Set<number>();
  for (const source of sources) {
    const citedHere = cited ? cited.has(source.n) : true;
    if (!citedHere || seenNumbers.has(source.n)) continue;
    seenNumbers.add(source.n);
    const key = analyticsSourceGroupKey(source);
    const kind = analyticsSourceKind(source);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sourceKind: kind,
        documentId: kind === "document" ? (source.documentId ?? null) : null,
        briefId: kind === "brief" ? (source.briefId ?? null) : null,
        chunks: [],
        citedNumbers: [],
        citationChunks: new Map(),
        displayedChunkCount: 0,
      };
      groups.set(key, group);
      seenChunks.set(key, new Map());
    }
    // A repeated reference to the same chunk is one fragment, one number.
    const chunkIdentity = source.chunkId || `n:${source.n}`;
    if (!seenChunks.get(key)!.has(chunkIdentity)) {
      seenChunks.get(key)!.set(chunkIdentity, source);
      group.chunks.push(source);
      group.displayedChunkCount += 1;
    }
    group.citationChunks.set(source.n, seenChunks.get(key)!.get(chunkIdentity)!);
    group.citedNumbers.push(source.n);
  }
  for (const group of groups.values()) group.citedNumbers.sort((a, b) => a - b);
  return [...groups.values()];
}

/** DOM identity is scoped to one displayed answer/history entry; numbering stays intact. */
export function analyticsFragmentId(groupKey: string, n: number, navigationScope = ""): string {
  return `${navigationScope ? `${navigationScope}-` : ""}fragment-${groupKey}-${n}`;
}

export function analyticsFragmentAnchor(groupKey: string, n: number, navigationScope = ""): string {
  return `#${encodeURIComponent(analyticsFragmentId(groupKey, n, navigationScope))}`;
}

/** Also signals repeated jumps to the current hash, which do not fire hashchange. */
export function navigateToAnalyticsFragment(anchor: string): void {
  if (window.location.hash !== anchor) window.history.pushState(null, "", anchor);
  window.dispatchEvent(new Event("hashchange"));
}

export type AnalyticsSourceCounts = {
  /** Unique parent materials represented by the supplied sources. */
  materials: number;
  /** Unique chunks represented by the supplied sources. */
  fragments: number;
};

export function analyticsSourceCounts<S extends GroupableSource>(
  sources: readonly S[],
  cited?: ReadonlySet<number>,
): AnalyticsSourceCounts {
  const groups = groupAnalyticsSources(sources, cited);
  return {
    materials: groups.length,
    fragments: groups.reduce((total, group) => total + group.displayedChunkCount, 0),
  };
}
