import { describe, expect, it } from "vitest";

import {
  legacySummaryStatus,
  readStoredSummary,
  readStoredSummaryStatus,
  sourceSummaryState,
  summaryRetryNeeded,
} from "./source-summary-state";
import { MIN_SUMMARY_TEXT_LENGTH } from "./summary-generation";

function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 99,
    title: "Bakıda yeni nəqliyyat layihəsi",
    summary: "Layihə Bakı şəhərində icra olunur və bir neçə mərhələdən ibarətdir.",
    claims: ["Layihə üç mərhələdə həyata keçiriləcək."],
    entities: ["Bakı"],
    eventDate: null,
    publicationDate: "2026-10-01",
    quote: null,
    relevance: "tangential",
    ...overrides,
  };
}

function legacy(): Record<string, unknown> {
  const { relevance: _relevance, ...rest } = stored();
  return rest;
}

const LONG_SNIPPET = "Bu mətn kifayət qədər uzundur. ".repeat(10);
const SHORT_SNIPPET = "Qısa mətn.";

describe("readStoredSummary", () => {
  it("accepts a valid Azerbaijani record and takes the number from the row", () => {
    const result = readStoredSummary(stored(), 5);
    expect(result).not.toBeNull();
    expect(result?.number).toBe(5);
    expect(result?.relevance).toBe("tangential");
    expect(result?.claims).toEqual(["Layihə üç mərhələdə həyata keçiriləcək."]);
    expect(result?.publicationDate).toBe("2026-10-01");
  });

  it("defaults a legacy record without relevance to direct", () => {
    expect(readStoredSummary(legacy(), 2)?.relevance).toBe("direct");
  });

  it("keeps an explicit offtopic classification", () => {
    expect(readStoredSummary(stored({ relevance: "offtopic" }), 2)?.relevance).toBe("offtopic");
  });

  it("rejects non-Azerbaijani title, summary or claims", () => {
    expect(readStoredSummary(stored({ title: "New transport project in the city" }), 1)).toBeNull();
    expect(
      readStoredSummary(stored({ summary: "The project is implemented in the capital city." }), 1),
    ).toBeNull();
    expect(
      readStoredSummary(
        stored({ claims: ["Layihə üç mərhələdə başa çatacaq.", "The plan will be completed."] }),
        1,
      ),
    ).toBeNull();
    expect(
      readStoredSummary(stored({ summary: "Проект реализуется в столице города." }), 1),
    ).toBeNull();
  });

  it("rejects records of the wrong shape", () => {
    expect(readStoredSummary(null, 1)).toBeNull();
    expect(readStoredSummary(undefined, 1)).toBeNull();
    expect(readStoredSummary("summary", 1)).toBeNull();
    expect(readStoredSummary([], 1)).toBeNull();
    expect(readStoredSummary({}, 1)).toBeNull();
    expect(readStoredSummary({ summaryStatus: "generation_failed" }, 1)).toBeNull();
    expect(readStoredSummary(stored({ title: "" }), 1)).toBeNull();
    expect(readStoredSummary(stored({ summary: 12 }), 1)).toBeNull();
    expect(readStoredSummary(stored({ claims: "yoxdur" }), 1)).toBeNull();
    expect(readStoredSummary(stored({ claims: ["bir", "iki", "üç", "dörd"] }), 1)).toBeNull();
    expect(readStoredSummary(stored({ relevance: "unknown" }), 1)).toBeNull();
    expect(readStoredSummary(stored({ extra: "field" }), 1)).toBeNull();
    expect(readStoredSummary(stored({ summaryStatus: "invalid_output" }), 1)).toBeNull();
    const { quote: _quote, ...withoutQuote } = stored();
    expect(readStoredSummary(withoutQuote, 1)).toBeNull();
  });
});

describe("readStoredSummaryStatus", () => {
  it("reads each known status", () => {
    for (const status of [
      "unavailable",
      "insufficient_text",
      "generation_failed",
      "invalid_output",
    ] as const) {
      expect(readStoredSummaryStatus({ summaryStatus: status })).toBe(status);
    }
  });

  it("returns null for unknown statuses and non-record values", () => {
    expect(readStoredSummaryStatus({ summaryStatus: "bogus" })).toBeNull();
    expect(readStoredSummaryStatus({ summaryStatus: 3 })).toBeNull();
    expect(readStoredSummaryStatus({ summaryStatus: null })).toBeNull();
    expect(readStoredSummaryStatus({})).toBeNull();
    expect(readStoredSummaryStatus(null)).toBeNull();
    expect(readStoredSummaryStatus(undefined)).toBeNull();
    expect(readStoredSummaryStatus("generation_failed")).toBeNull();
    expect(readStoredSummaryStatus(["generation_failed"])).toBeNull();
  });
});

describe("legacySummaryStatus", () => {
  it("maps empty text to unavailable", () => {
    expect(legacySummaryStatus("")).toBe("unavailable");
    expect(legacySummaryStatus("   \n\t ")).toBe("unavailable");
  });

  it("maps text below the threshold to insufficient_text", () => {
    expect(legacySummaryStatus("x")).toBe("insufficient_text");
    expect(legacySummaryStatus("a".repeat(MIN_SUMMARY_TEXT_LENGTH - 1))).toBe("insufficient_text");
  });

  it("maps text at or above the threshold to generation_failed", () => {
    expect(legacySummaryStatus("a".repeat(MIN_SUMMARY_TEXT_LENGTH))).toBe("generation_failed");
    expect(legacySummaryStatus("a".repeat(2_000))).toBe("generation_failed");
  });

  it("measures the trimmed length", () => {
    const padded = "   " + "a".repeat(MIN_SUMMARY_TEXT_LENGTH - 1) + "   ";
    expect(legacySummaryStatus(padded)).toBe("insufficient_text");
  });
});

describe("sourceSummaryState", () => {
  it("returns the summary and no status for a valid stored summary", () => {
    const state = sourceSummaryState({ structuredSummary: stored(), snippet: "", n: 7 });
    expect(state.status).toBeNull();
    expect(state.summary?.number).toBe(7);
  });

  it("derives a status for old records with null structuredSummary from the snippet", () => {
    expect(sourceSummaryState({ structuredSummary: null, snippet: "", n: 1 })).toEqual({
      summary: null,
      status: "unavailable",
    });
    expect(sourceSummaryState({ structuredSummary: null, snippet: SHORT_SNIPPET, n: 1 })).toEqual({
      summary: null,
      status: "insufficient_text",
    });
    expect(sourceSummaryState({ structuredSummary: null, snippet: LONG_SNIPPET, n: 1 })).toEqual({
      summary: null,
      status: "generation_failed",
    });
  });

  it("prefers a stored summaryStatus over the snippet-based legacy status", () => {
    expect(
      sourceSummaryState({
        structuredSummary: { summaryStatus: "invalid_output" },
        snippet: LONG_SNIPPET,
        n: 1,
      }),
    ).toEqual({ summary: null, status: "invalid_output" });
    expect(
      sourceSummaryState({
        structuredSummary: { summaryStatus: "unavailable" },
        snippet: LONG_SNIPPET,
        n: 1,
      }),
    ).toEqual({ summary: null, status: "unavailable" });
  });

  it("falls back to the legacy status for an unknown stored status or an invalid summary", () => {
    expect(
      sourceSummaryState({
        structuredSummary: { summaryStatus: "bogus" },
        snippet: LONG_SNIPPET,
        n: 1,
      }).status,
    ).toBe("generation_failed");
    expect(
      sourceSummaryState({
        structuredSummary: stored({ summary: "The project is implemented in the capital city." }),
        snippet: SHORT_SNIPPET,
        n: 1,
      }),
    ).toEqual({ summary: null, status: "insufficient_text" });
  });
});

describe("summaryRetryNeeded", () => {
  const valid = (n: number) => ({ n, structuredSummary: stored(), snippet: LONG_SNIPPET });
  const failed = (n: number) => ({ n, structuredSummary: null, snippet: LONG_SNIPPET });
  const invalid = (n: number) => ({
    n,
    structuredSummary: { summaryStatus: "invalid_output" },
    snippet: LONG_SNIPPET,
  });
  const unavailable = (n: number) => ({ n, structuredSummary: null, snippet: "" });
  const insufficient = (n: number) => ({
    n,
    structuredSummary: { summaryStatus: "insufficient_text" },
    snippet: SHORT_SNIPPET,
  });

  it("is false for a run without sources", () => {
    expect(summaryRetryNeeded({ sources: [], hasReport: false })).toBe(false);
    expect(summaryRetryNeeded({ sources: [], hasReport: true })).toBe(false);
  });

  it("is true when any source failed generation or produced invalid output", () => {
    expect(summaryRetryNeeded({ sources: [valid(1), failed(2)], hasReport: true })).toBe(true);
    expect(summaryRetryNeeded({ sources: [valid(1), invalid(2)], hasReport: true })).toBe(true);
    expect(summaryRetryNeeded({ sources: [failed(1)], hasReport: false })).toBe(true);
  });

  it("is false when only unavailable or insufficient-text sources lack summaries", () => {
    expect(
      summaryRetryNeeded({ sources: [unavailable(1), insufficient(2)], hasReport: false }),
    ).toBe(false);
    expect(
      summaryRetryNeeded({ sources: [valid(1), unavailable(2), insufficient(3)], hasReport: true }),
    ).toBe(false);
  });

  it("is false when every summary is valid and a report exists", () => {
    expect(summaryRetryNeeded({ sources: [valid(1), valid(2)], hasReport: true })).toBe(false);
  });

  it("is true when valid summaries exist but the report is missing", () => {
    expect(summaryRetryNeeded({ sources: [valid(1), valid(2)], hasReport: false })).toBe(true);
    expect(summaryRetryNeeded({ sources: [valid(1), unavailable(2)], hasReport: false })).toBe(
      true,
    );
  });

  it("does not request a retry when nothing can be summarized and nothing is retryable", () => {
    expect(summaryRetryNeeded({ sources: [unavailable(1)], hasReport: false })).toBe(false);
  });
});
