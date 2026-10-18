import { z } from "zod";

import type { InfoCredibility, SourceReliability } from "./reliability";
import { departmentIdSchema, departmentIds } from "./departments";

export const analyticsFiltersSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "12m", "all"]),
  tag: z.string().max(64),
  departmentIds: z
    .array(departmentIdSchema)
    .min(1)
    .max(departmentIds.length)
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
  department: string | null;
  sectionTitle: string;
  text: string;
  quote: string;
  charStart: number;
  charEnd: number;
  isTable: boolean;
  attachmentCount: number;
  tags: string[];
  sourceReliability: SourceReliability | null;
  infoCredibility: InfoCredibility | null;
};

export type AnalyticsSourcePreview = Omit<AnalyticsSource, "text" | "charStart" | "charEnd">;

export type AnalyticsOptions = {
  tags: string[];
};
