import { looksAzerbaijani } from "./language";
import {
  SUMMARY_STATUSES,
  sourceSummaryStoredSchema,
  type SourceRelevance,
  type SummaryStatus,
} from "./reports";
import { MIN_SUMMARY_TEXT_LENGTH } from "./summary-generation";

export type StoredSourceSummary = {
  number: number;
  title: string;
  summary: string;
  claims: string[];
  entities: string[];
  eventDate: string | null;
  publicationDate: string | null;
  quote: string | null;
  relevance: SourceRelevance;
};

export function readStoredSummary(value: unknown, number: number): StoredSourceSummary | null {
  const parsed = sourceSummaryStoredSchema.safeParse(value);
  if (
    !parsed.success ||
    !looksAzerbaijani(parsed.data.title) ||
    !looksAzerbaijani(parsed.data.summary) ||
    parsed.data.claims.some((claim) => !looksAzerbaijani(claim))
  ) {
    return null;
  }
  return { ...parsed.data, number, relevance: parsed.data.relevance ?? "direct" };
}

export function readStoredSummaryStatus(value: unknown): SummaryStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>)["summaryStatus"];
  return SUMMARY_STATUSES.find((item) => item === status) ?? null;
}

export function legacySummaryStatus(text: string): SummaryStatus {
  const length = text.trim().length;
  if (!length) return "unavailable";
  return length < MIN_SUMMARY_TEXT_LENGTH ? "insufficient_text" : "generation_failed";
}

export function sourceSummaryState(row: {
  structuredSummary: unknown;
  snippet: string;
  n: number;
}): {
  summary: StoredSourceSummary | null;
  status: SummaryStatus | null;
} {
  const summary = readStoredSummary(row.structuredSummary, row.n);
  if (summary) return { summary, status: null };
  return {
    summary: null,
    status: readStoredSummaryStatus(row.structuredSummary) ?? legacySummaryStatus(row.snippet),
  };
}

export function summaryRetryNeeded(input: {
  sources: readonly { n: number; structuredSummary: unknown; snippet: string }[];
  hasReport: boolean;
}): boolean {
  if (!input.sources.length) return false;
  const states = input.sources.map(sourceSummaryState);
  const retryable = states.some(
    (state) => state.status === "generation_failed" || state.status === "invalid_output",
  );
  return retryable || (!input.hasReport && states.some((state) => state.summary));
}
