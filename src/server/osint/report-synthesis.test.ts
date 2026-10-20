import { describe, expect, it, vi } from "vitest";

import { simplifiedStructuredReportSchema, structuredReportSchema } from "./reports";
import { synthesizeReport, type SynthesisSource } from "./report-synthesis";

function source(
  overrides: Partial<SynthesisSource> & Pick<SynthesisSource, "number">,
): SynthesisSource {
  return {
    title: "Başlıq",
    summary: "",
    claims: [],
    entities: [],
    eventDate: null,
    publicationDate: null,
    relevance: "direct",
    domain: "example.org",
    language: "en",
    sourceType: "other",
    quote: null,
    ...overrides,
  };
}

const sources: SynthesisSource[] = [
  source({
    number: 1,
    title: "Bakı və Ankara müdafiə sazişi imzalayıb",
    summary:
      "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Saziş 2025 ildə qüvvəyə minib.",
    claims: ["Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb"],
    entities: ["Azərbaycan", "Türkiyə", "Bakı"],
    eventDate: "2025-03-10",
  }),
  source({
    number: 2,
    title: "Qafqazda regional təhlükəsizlik müzakirələri",
    summary: "Regional təhlükəsizlik ekspertləri Tbilisidə 2024 ildə Qafqaz üzrə müzakirə ediblər.",
    entities: ["Tbilisi", "Qafqaz"],
    relevance: "tangential",
  }),
  source({
    number: 3,
    title: "Futbol çempionatının yekunları",
    summary: "Yerli klublar mövsümün son turunda qələbə qazanıb.",
    relevance: "offtopic",
  }),
];

const goodBluf =
  "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Saziş 2025 ildə imzalanıb və müdafiə sənayesini əhatə edir.";
const vagueBluf =
  "Müxtəlif mənbələrdə müxtəlif məlumatlar dərc olunub. Bu mövzuda bir sıra xəbərlər yayılıb.";
const finding = {
  text: "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Müdafiə sazişi 2025 ildə qüvvəyə minib.",
  sourceNumbers: [1],
};

function fullReport(overrides: Record<string, unknown> = {}) {
  return {
    bluf: goodBluf,
    blufSourceNumbers: [1],
    keyFindings: [finding],
    timeline: [],
    perspectives: [],
    disagreements: [],
    entities: [],
    gaps: [],
    watch: [],
    caveats: [],
    ...overrides,
  };
}

function harness(responses: (() => unknown)[]) {
  const queue = [...responses];
  const generateObject = vi.fn(async (_options: unknown, _schema: unknown) => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra model call");
    return next();
  });
  return {
    generateObject,
    run: (extra: { canRetry?: () => boolean; signal?: AbortSignal } = {}) =>
      synthesizeReport({
        query: "Azərbaycan Türkiyə müdafiə",
        sources,
        light: { generateObject: generateObject as never },
        thinkingLevel: "low",
        signal: extra.signal ?? new AbortController().signal,
        ...(extra.canRetry ? { canRetry: extra.canRetry } : {}),
      }),
  };
}

describe("synthesizeReport", () => {
  it("returns a validated report after a single model call", async () => {
    const h = harness([() => fullReport()]);
    const result = await h.run();
    expect(result.attempts).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.report?.bluf).toBe(goodBluf);
    expect(result.report?.blufSourceNumbers).toEqual([1]);
  });

  it("sends only on-topic sources to the model and never the off-topic ones", async () => {
    const h = harness([() => fullReport()]);
    await h.run();
    const options = h.generateObject.mock.calls[0]![0] as { prompt: string };
    expect(options.prompt).toContain("Bakı və Ankara");
    expect(options.prompt).toContain("Qafqazda regional");
    expect(options.prompt).not.toContain("Futbol");
    expect(h.generateObject.mock.calls[0]![1]).toBe(structuredReportSchema);
  });

  it("retries the BLUF once with a stronger instruction and keeps the valid result", async () => {
    const h = harness([() => fullReport({ bluf: vagueBluf }), () => fullReport()]);
    const result = await h.run();
    expect(result.attempts).toBe(2);
    expect(result.report?.bluf).toBe(goodBluf);
    expect(result.notes).toEqual([]);
    const second = h.generateObject.mock.calls[1]![0] as { prompt: string; temperature: number };
    const first = h.generateObject.mock.calls[0]![0] as { prompt: string };
    expect(second.prompt).toContain("previous BLUF was rejected");
    expect(first.prompt).not.toContain("previous BLUF was rejected");
    expect(second.temperature).toBe(0);
  });

  it("builds the BLUF from validated findings after exactly one failed retry", async () => {
    const h = harness([
      () => fullReport({ bluf: vagueBluf }),
      () => fullReport({ bluf: vagueBluf }),
    ]);
    const result = await h.run();
    expect(result.attempts).toBe(2);
    expect(result.notes).toContain("bluf_fallback");
    expect(result.report?.bluf).toBe(finding.text);
    expect(result.report?.blufSourceNumbers).toEqual([1]);
  });

  it("does not retry when the caller says the time budget is gone", async () => {
    const h = harness([() => fullReport({ bluf: vagueBluf })]);
    const result = await h.run({ canRetry: () => false });
    expect(result.attempts).toBe(1);
    expect(result.notes).toContain("bluf_fallback");
    expect(h.generateObject).toHaveBeenCalledTimes(1);
  });

  it("flags weak claims instead of presenting them as findings", async () => {
    const weak = { text: "Rusiya Moskvada 2030 ildə sazişi ləğv edib.", sourceNumbers: [1] };
    const h = harness([() => fullReport({ keyFindings: [finding, weak] })]);
    const result = await h.run();
    expect(result.notes).toContain("weak_claims");
    expect(result.report?.keyFindings).toEqual([finding]);
    expect(result.report?.weakFindings).toEqual([{ text: weak.text }]);
  });

  it("drops source numbers that do not belong to the on-topic set", async () => {
    const h = harness([
      () =>
        fullReport({
          blufSourceNumbers: [1, 3, 99],
          keyFindings: [{ ...finding, sourceNumbers: [1, 3] }],
        }),
    ]);
    const result = await h.run();
    expect(result.failures).toEqual([{ name: "report:invalid_source_numbers" }]);
    expect(result.report?.blufSourceNumbers).toEqual([1]);
    expect(result.report?.keyFindings[0]?.sourceNumbers).toEqual([1]);
  });

  it("falls back to the compact schema after a failed call and then succeeds", async () => {
    const h = harness([
      () => {
        throw new Error("model timeout");
      },
      () => ({ bluf: goodBluf, blufSourceNumbers: [1], keyFindings: [finding] }),
    ]);
    const result = await h.run();
    expect(result.attempts).toBe(2);
    expect(h.generateObject.mock.calls[1]![1]).toBe(simplifiedStructuredReportSchema);
    expect(result.report?.bluf).toBe(goodBluf);
  });

  it("reports a failure without a report when both attempts throw", async () => {
    const h = harness([
      () => {
        throw new Error("down");
      },
      () => {
        throw new Error("still down");
      },
    ]);
    const result = await h.run();
    expect(result.report).toBeNull();
    expect(result.attempts).toBe(2);
    expect(result.failures.map((failure) => failure.name)).toEqual(["synthesizing"]);
  });

  it("rejects a non-Azerbaijani report instead of publishing it", async () => {
    const h = harness([
      () => fullReport({ bluf: "The sources describe talks between two defense ministries." }),
      () => fullReport({ bluf: "The sources describe talks between two defense ministries." }),
    ]);
    const result = await h.run();
    expect(result.report).toBeNull();
    expect(result.failures.map((failure) => failure.name)).toEqual(["synthesizing"]);
  });

  it("makes no model call when every source is off-topic", async () => {
    const generateObject = vi.fn();
    const result = await synthesizeReport({
      query: "x",
      sources: [sources[2]!],
      light: { generateObject: generateObject as never },
      thinkingLevel: "low",
      signal: new AbortController().signal,
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toEqual({
      report: null,
      failures: [{ name: "synthesizing:no_relevant_sources" }],
      notes: [],
      attempts: 0,
    });
  });

  it("reports unavailable structured output without throwing", async () => {
    const result = await synthesizeReport({
      query: "x",
      sources,
      light: {},
      thinkingLevel: "low",
      signal: new AbortController().signal,
    });
    expect(result.report).toBeNull();
    expect(result.attempts).toBe(0);
    expect(result.failures[0]?.name).toBe("synthesizing");
  });
});
