import { describe, expect, it } from "vitest";

import {
  isStructuredReportAzerbaijani,
  keepExplicitTimelineDates,
  parseSourceSummaries,
  parseStructuredReport,
  quoteIsExact,
  type StructuredReport,
} from "./reports";
import { isAzerbaijaniSummaryContent, looksAzerbaijani } from "./language";
import { az } from "@/lib/i18n/az";

function validReport(overrides: Record<string, unknown> = {}) {
  return {
    bluf: "M\u0259nb\u0259l\u0259r g\u00f6r\u00fc\u015fl\u0259ri t\u0259svir edir.",
    blufSourceNumbers: [1],
    keyFindings: [
      {
        text: "G\u00f6r\u00fc\u015f bar\u0259d\u0259 m\u0259lumat yay\u0131ld\u0131.",
        sourceNumbers: [1, 99],
      },
    ],
    timeline: [
      { date: "2026-10-18", event: "G\u00f6r\u00fc\u015f ke\u00e7irildi.", sourceNumbers: [1] },
      { date: "2026-10-20", event: "Tarix t\u0259sdiql\u0259nm\u0259yib.", sourceNumbers: [1] },
    ],
    perspectives: [
      {
        group: "R\u0259smi m\u0259nb\u0259",
        summary: "Dan\u0131\u015f\u0131qlar davam edir.",
        sourceNumbers: [1],
      },
    ],
    disagreements: [],
    entities: [{ name: "Moscow", sourceNumbers: [1] }],
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

  it("validates every user-facing report field while leaving entity names untouched", () => {
    const report = validReport() as StructuredReport;
    expect(isStructuredReportAzerbaijani(report)).toBe(true);
    expect(isStructuredReportAzerbaijani({ ...report, bluf: "The sources describe talks." })).toBe(
      false,
    );
    expect(
      isStructuredReportAzerbaijani({
        ...report,
        entities: [{ name: "Москва", sourceNumbers: [1] }],
      }),
    ).toBe(true);
  });

  it("validates short and multilingual summary text as Azerbaijani Latin", () => {
    expect(looksAzerbaijani("G\u00f6r\u00fc\u015f var.")).toBe(true);
    expect(looksAzerbaijani("v\u0259")).toBe(true);
    expect(
      looksAzerbaijani(
        "M\u0259lumat \u0130lham \u018fl\u0131yev v\u0259 Bak\u0131 il\u0259 ba\u011fl\u0131d\u0131r.",
      ),
    ).toBe(true);
    expect(looksAzerbaijani("Baku haqq\u0131nda q\u0131sa m\u0259lumat verildi.")).toBe(true);
    expect(looksAzerbaijani("The report and the analysis are ready.")).toBe(false);
    expect(
      looksAzerbaijani(
        "\u0412\u0441\u0442\u0440\u0435\u0447\u0430 \u043f\u0440\u043e\u0448\u043b\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f.",
      ),
    ).toBe(false);
    expect(
      looksAzerbaijani(
        "\u0645\u0644\u0627\u0642\u0627\u062a \u0627\u0645\u0631\u0648\u0632 \u0628\u0631\u06af\u0632\u0627\u0631 \u0634\u062f.",
      ),
    ).toBe(false);
    expect(looksAzerbaijani("\u4eca\u5929\u4f1a\u8bae\u4e3e\u884c\u3002")).toBe(false);
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
          title: "Az\u0259rbaycanda g\u00f6r\u00fc\u015f haqq\u0131nda",
          summary:
            "M\u0259nb\u0259d\u0259 g\u00f6r\u00fc\u015f bar\u0259d\u0259 q\u0131sa m\u0259lumat verilir.",
          claims: ["M\u0259lumat r\u0259smi olaraq a\u00e7\u0131qland\u0131."],
          entities: ["Moscow"],
          eventDate: "2026-10-18",
          publicationDate: "not sourced",
          quote: "invented phrase",
          relevance: "direct",
        },
      ],
    });
    const [summary] = parseSourceSummaries(response, [
      { number: 1, title: "Title", text: "The meeting happened on 2026-10-18." },
    ]);
    expect(summary).toMatchObject({ eventDate: "2026-10-18", publicationDate: null, quote: null });
  });

  it("keeps an Azerbaijani summary with an original-language title, entity, and exact quote", () => {
    const quote = "Встреча состоялась в Москве.";
    const summary =
      "The Guardian qəzetinin məlumatına görə görüş Bakıda keçirilib və Москва şəhəri ilə bağlı nəticələr açıqlanacaq.";
    const claims = ["Görüşün nəticələri növbəti həftə açıqlanacaq."];
    const response = JSON.stringify({
      sources: [
        {
          number: 1,
          title: "The Guardian",
          summary,
          claims,
          entities: ["The Guardian", "Москва"],
          eventDate: null,
          publicationDate: null,
          quote,
          relevance: "direct",
        },
      ],
    });

    expect(isAzerbaijaniSummaryContent(summary, claims)).toBe(true);
    const parsed = parseSourceSummaries(response, [
      { number: 1, title: "Source title", text: `Article text. ${quote}` },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ title: "The Guardian", quote });
  });

  it("accepts a short Azerbaijani summary with a foreign-language title", () => {
    const response = JSON.stringify({
      sources: [
        {
          number: 1,
          title: "Regional meeting",
          summary: "Görüş var.",
          claims: [],
          entities: ["Moscow"],
          eventDate: null,
          publicationDate: null,
          quote: null,
          relevance: "direct",
        },
      ],
    });

    expect(
      parseSourceSummaries(response, [{ number: 1, title: "Source", text: "Text" }]),
    ).toHaveLength(1);
  });

  it("still rejects a mixed-language summary even when its title is foreign-language", () => {
    const response = JSON.stringify({
      sources: [
        {
          number: 1,
          title: "The Guardian",
          summary: "Görüş barədə məlumat yayımlandı. The report was published today.",
          claims: [],
          entities: ["The Guardian"],
          eventDate: null,
          publicationDate: null,
          quote: null,
          relevance: "direct",
        },
      ],
    });

    expect(parseSourceSummaries(response, [{ number: 1, title: "Source", text: "Text" }])).toEqual(
      [],
    );
  });

  it("drops source-language summaries instead of copying them through", () => {
    const response = JSON.stringify({
      sources: [
        {
          number: 1,
          title: "Regional talks today",
          summary: "The meeting happened today.",
          claims: ["A meeting was announced."],
          entities: ["Example"],
          eventDate: null,
          publicationDate: null,
          quote: null,
          relevance: "direct",
        },
      ],
    });
    expect(parseSourceSummaries(response, [{ number: 1, title: "Title", text: "Text" }])).toEqual(
      [],
    );
  });

  it("keeps valid Azerbaijani rows when another source fails language validation", () => {
    const response = JSON.stringify({
      sources: [
        {
          number: 1,
          title: "Bakı görüşü",
          summary: "Mənbə görüşün Bakıda keçirildiyini bildirir.",
          claims: ["Görüş Bakıda baş tutub."],
          entities: ["Bakı"],
          eventDate: null,
          publicationDate: null,
          quote: null,
          relevance: "direct",
        },
        {
          number: 2,
          title: "Regional talks today",
          summary: "The meeting happened today.",
          claims: ["A meeting was announced."],
          entities: ["Example"],
          eventDate: null,
          publicationDate: null,
          quote: null,
          relevance: "direct",
        },
      ],
    });
    expect(
      parseSourceSummaries(response, [
        { number: 1, title: "Title one", text: "Text one" },
        { number: 2, title: "Title two", text: "Text two" },
      ]).map((summary) => summary.number),
    ).toEqual([1]);
  });
});
