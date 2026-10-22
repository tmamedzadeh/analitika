import { z } from "zod";

import type { InfoCredibility, SourceReliability } from "./reliability";
import { directionIdSchema, directionIds } from "./directions";

// Leave time for the server's terminal SSE event within Vercel's 120s function limit.
export const ANALYTICS_SERVER_DEADLINE_MS = 105_000;
export const ANALYTICS_CLIENT_DEADLINE_MS = 115_000;

export function citedSourceNumbers(answer: string): Set<number> {
  return new Set([...answer.matchAll(/\[(\d+)\]/gu)].map((match) => Number(match[1])));
}

export const analyticsFiltersSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "12m", "all"]),
  directionIds: z
    .array(directionIdSchema)
    .min(1)
    .max(directionIds.length)
    .refine((values) => new Set(values).size === values.length),
  minSourceReliability: z.enum(["all", "A", "B", "C", "D", "E", "F"]),
  minInfoCredibility: z.enum(["all", "1", "2", "3", "4", "5", "6"]),
});

export const analyticsSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  filters: analyticsFiltersSchema,
  mode: z.enum(["answer", "sources"]),
});

export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>;
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
