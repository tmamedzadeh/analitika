import { z } from "zod";

import type { InfoCredibility, SourceReliability } from "./reliability";

export const analyticsFiltersSchema = z.object({
  period: z.enum(["12m", "30d", "all"]),
  tag: z.string().max(64),
  documentId: z.string().uuid().or(z.literal("")),
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
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  docDate: string | null;
  sectionTitle: string;
  text: string;
  quote: string;
  charStart: number;
  charEnd: number;
  isTable: boolean;
  attachmentCount: number;
  tags: string[];
  sourceReliability: SourceReliability;
  infoCredibility: InfoCredibility;
};

export type AnalyticsSourcePreview = Omit<AnalyticsSource, "text" | "charStart" | "charEnd">;

export type AnalyticsOptions = {
  tags: string[];
  documents: Array<{ id: string; title: string; docDate: string | null }>;
};
