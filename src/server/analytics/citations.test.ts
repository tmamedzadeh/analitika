import { describe, expect, it } from "vitest";
import {
  analyticsPublicationFailureReasons,
  canPublishAnalyticsAnswer,
  validateCitations,
} from "./citations";

const sources = [
  {
    n: 1,
    sourceReliability: "A",
    infoCredibility: 1,
    text: "Şirkət 100 milyon investisiya elan etdi.",
  },
  { n: 2, sourceReliability: "D", infoCredibility: 5, text: "Layihə 2026-cı ildə başlayacaq." },
  { n: 3, sourceReliability: null, infoCredibility: null, text: "Gündəlik xülasə." },
] as const;

describe("standard RAG citation validation", () => {
  it("accepts an analytical answer with headings, lists, dates and paragraph-level citations", () => {
    const answer =
      "## İnvestisiya\n1. Şirkət 100 milyon investisiya elan etdi. Layihənin təsiri mərhələli olacaq [1].\n2. Başlanğıc 2026-cı ildir [2].\n\nƏlavə məlumat kifayət etmir.";
    const result = validateCitations(answer, sources);
    expect(result.incomplete).toBe(false);
    expect(result.answer).toBe(answer);
    expect(canPublishAnalyticsAnswer(answer, "stop", result)).toBe(true);
  });

  it.each(["Məlumat cavab üçün kifayət etmir.", "Mənbələrdə məlumat tapılmadı."])(
    "allows a completed insufficient-information response without mandatory citations: %s",
    (answer) => {
      const result = validateCitations(answer, sources);
      expect(canPublishAnalyticsAnswer(answer, "stop", result)).toBe(true);
    },
  );

  it("checks citation membership without judging numbers or requiring exact excerpts", () => {
    const answer = "Göstərici 12,5% təşkil edir [1].";
    const result = validateCitations(answer, sources);
    expect(result.failureReasons).toEqual([]);
    expect(result.answer).toBe(answer);
  });

  it("normalizes citation groups, ranges and whitespace while checking every number", () => {
    const result = validateCitations("Nəticə [1, 2; 3]. Digər nəticə [1–3], [ 1 ].", sources);
    expect(result.incomplete).toBe(false);
    expect(result.answer).toBe("Nəticə [1][2][3]. Digər nəticə [1][2][3], [1].");
  });

  it.each(["Nəticə [7].", "Nəticə [1,7].", "Nəticə [0].", "Nəticə [9007199254740993]."])(
    "rejects citations outside the authorized retrieved set: %s",
    (answer) => {
      const result = validateCitations(answer, sources);
      expect(result.failureReasons).toContain("unknown_citation");
      expect(canPublishAnalyticsAnswer(answer, "stop", result)).toBe(false);
    },
  );

  it("cannot cite an existing document omitted from the authorized source set", () => {
    const result = validateCitations("Nəticə [2].", [sources[0]]);
    expect(result.failureReasons).toContain("unknown_citation");
  });

  it.each(["Nəticə [3-1].", "Nəticə [1-999999]."])("bounds citation ranges: %s", (answer) => {
    expect(validateCitations(answer, sources).failureReasons).toContain("invalid_citation_range");
  });

  it("discards optional legacy evidence annotations without validating their contents", () => {
    const result = validateCitations(
      "Nəticə [1]⟦E7: format [99], rəqəm 999 və Unicode — «mətn»⟧. Digər nəticə [1]. ⟦E",
      sources,
    );
    expect(result.incomplete).toBe(false);
    expect(result.answer).toBe("Nəticə [1]. Digər nəticə [1].");
  });

  it("ignores a model URL while still validating the citation number", () => {
    expect(
      validateCitations("Nəticə [1](https://untrusted.test/senedler/secret).", sources).answer,
    ).toBe("Nəticə [1].");
    expect(validateCitations("Nəticə [99](https://untrusted.test).", sources).incomplete).toBe(
      true,
    );
  });

  it("tracks cited low ratings without appending a blanket warning", () => {
    expect(validateCitations("Nəticə [1].", sources).usedLowReliability).toBe(false);
    const result = validateCitations("Nəticə [2].", sources);
    expect(result.usedLowReliability).toBe(true);
    expect(result.answer).toBe("Nəticə [2].");
  });
});

describe("answer completeness", () => {
  it.each(["", "  ", "## ", "[1]", "[1, 2]", "⟦E1: daxili mətn⟧"])(
    "rejects an empty answer: %s",
    (answer) => {
      const validation = validateCitations(answer, sources);
      expect(analyticsPublicationFailureReasons(answer, "stop", validation)).toContain(
        "empty_answer",
      );
    },
  );

  it.each(["length", "content-filter", "tool-calls", "error", "other", "unknown"])(
    "does not publish a technically unfinished %s completion",
    (finishReason) => {
      expect(canPublishAnalyticsAnswer("Nəticə [1].", finishReason, { incomplete: false })).toBe(
        false,
      );
    },
  );

  it("rejects an unfinished citation and accepts a completed answer", () => {
    expect(canPublishAnalyticsAnswer("Nəticə [1", "stop", { incomplete: false })).toBe(false);
    expect(
      canPublishAnalyticsAnswer("Nəticə [1](https://unfinished", "stop", { incomplete: false }),
    ).toBe(false);
    expect(canPublishAnalyticsAnswer("Nəticə [1].", "stop", { incomplete: false })).toBe(true);
  });
});
