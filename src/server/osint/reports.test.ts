import { describe, expect, it } from "vitest";

import {
  fallbackStructuredReport,
  keepExplicitTimelineDates,
  parseSourceSummaries,
  parseStructuredReport,
  quoteIsExact,
} from "./reports";
import { az } from "@/lib/i18n/az";

function validReport(overrides: Record<string, unknown> = {}) {
  return {
    bluf: "The sources describe talks.",
    blufSourceNumbers: [1],
    keyFindings: [{ text: "A meeting was announced.", sourceNumbers: [1, 99] }],
    timeline: [
      { date: "2026-10-18", event: "A meeting occurred.", sourceNumbers: [1] },
      { date: "2026-10-20", event: "An unsupported date.", sourceNumbers: [1] },
    ],
    perspectives: [{ group: "official", summary: "Talks are continuing.", sourceNumbers: [1] }],
    disagreements: [],
    entities: [{ name: "Example", sourceNumbers: [1] }],
    gaps: [],
    watch: [],
    caveats: [],
    ...overrides,
  };
}

describe("structured OSINT reports", () => {
  it("validates a report, drops unknown source numbers, and marks it incomplete", () => {
    const parsed = parseStructuredReport(JSON.stringify(validReport()), [1]);
    expect(parsed.incomplete).toBe(true);
    expect(parsed.report.keyFindings[0]?.sourceNumbers).toEqual([1]);
    expect(parsed.report.timeline).toHaveLength(2);
    expect(() =>
      parseStructuredReport(JSON.stringify(validReport({ extra: true })), [1]),
    ).toThrow();
  });

  it("requires citations for the BLUF when sources exist", () => {
    expect(() =>
      parseStructuredReport(JSON.stringify(validReport({ blufSourceNumbers: [500] })), [1]),
    ).toThrow(/source numbers/i);
  });

  it("keeps authenticated dates and labels unsupported timeline dates as unknown", () => {
    const report = parseStructuredReport(JSON.stringify(validReport()), [1]).report;
    const filtered = keepExplicitTimelineDates(report, [
      { number: 1, eventDate: null, publicationDate: "2026-10-18" },
    ]);
    expect(filtered.timeline.map((item) => item.date)).toEqual([
      "2026-10-18",
      az.osint.eventDateUnknown,
    ]);
  });

  it("validates quotes as exact whitespace-normalized substrings under 25 words", () => {
    expect(quoteIsExact("A   short quote", "The article says A short quote today.")).toBe(true);
    expect(quoteIsExact("not present", "Article body")).toBe(false);
    expect(
      quoteIsExact(new Array(26).fill("word").join(" "), new Array(30).fill("word").join(" ")),
    ).toBe(false);
  });

  it("removes fabricated quotes and dates from source summaries", () => {
    const response = JSON.stringify({
      sources: [
        {
          number: 1,
          title: "Azerbaijani title",
          summary: "Three sourced sentences.",
          claims: ["An explicit claim."],
          entities: ["Example"],
          eventDate: "2026-10-18",
          publicationDate: "not sourced",
          quote: "invented phrase",
        },
      ],
    });
    const [summary] = parseSourceSummaries(response, [
      { number: 1, title: "Title", text: "The meeting happened on 2026-10-18." },
    ]);
    expect(summary).toMatchObject({ eventDate: "2026-10-18", publicationDate: null, quote: null });
  });

  it("builds a safe cited fallback when final JSON is unavailable", () => {
    const report = fallbackStructuredReport([
      { number: 3, title: "Title", summary: "Source summary", claims: ["Claim"] },
    ]);
    expect(report.blufSourceNumbers).toEqual([3]);
    expect(report.keyFindings[0]?.sourceNumbers).toEqual([3]);
  });
});
