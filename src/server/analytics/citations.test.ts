import { describe, expect, it } from "vitest";

import { canPublishAnalyticsAnswer, validateCitations } from "./citations";

const sources = [
  {
    n: 1,
    sourceReliability: "A",
    infoCredibility: 1,
    documentId: "doc-1",
    chunkId: "chunk-1",
    text: "Şirkət 100 milyon ABŞ dolları investisiya elan etdi. Layihə 2025-ci ildə başlayacaq.",
  },
  {
    n: 2,
    sourceReliability: "D",
    infoCredibility: 5,
    documentId: "doc-2",
    chunkId: "chunk-2",
    text: "Mənbədə 50 milyon ABŞ dolları məbləği göstərilib.",
  },
] as const;

const investmentEvidence = "100 milyon ABŞ dolları investisiya elan etdi";

describe("validateCitations", () => {
  it.each([
    ["100", "2100"],
    ["99.5", "1.5"],
    ["100 milyard", "100 milyon"],
  ])(
    "rejects numeric mismatch %s versus %s without substring or decimal bypass",
    (claim, evidence) => {
      const result = validateCitations(
        `Məbləğ ${claim} təşkil edir [1]⟦E1: ${evidence}⟧.`,
        [{ ...sources[0], text: evidence }],
        "",
      );
      expect(result.incomplete).toBe(true);
      expect(result.evidenceChecks.unsupportedNumericFactCount).toBeGreaterThan(0);
    },
  );

  it("rejects an unfinished evidence marker after an otherwise valid claim", () => {
    expect(
      validateCitations(`İnvestisiya elan edildi [1]⟦E1: ${investmentEvidence}⟧. ⟦E`, sources, "")
        .incomplete,
    ).toBe(true);
  });

  it("does not interpret brackets inside a verified excerpt as answer citations", () => {
    const result = validateCitations(
      "Mənbə qeydi [1]⟦E1: qeyd [7] verilib⟧.",
      [{ ...sources[0], text: "qeyd [7] verilib" }],
      "",
    );
    expect(result.incomplete).toBe(false);
    expect(result.answer).toBe("Mənbə qeydi [1].");
  });
  it("removes unknown citations and marks the answer incomplete", () => {
    const result = validateCitations(
      `Fakt [1]⟦E1: ${investmentEvidence}⟧, naməlum istinad [7]⟦E7: olmayan⟧.`,
      sources,
      "aşağı etibar",
    );

    expect(result.answer).toBe("Fakt [1], naməlum istinad.");
    expect(result.incomplete).toBe(true);
    expect(result.usedLowReliability).toBe(false);
  });

  it("adds the Azerbaijani caveat when a low-reliability source is cited", () => {
    const result = validateCitations(
      "Mənbədə 50 milyon ABŞ dolları göstərilib [2]⟦E2: 50 milyon ABŞ dolları məbləği göstərilib⟧.",
      sources,
      "bu məlumat aşağı etibarlıdır",
    );

    expect(result.answer).toBe(
      "Mənbədə 50 milyon ABŞ dolları göstərilib [2].\n\nbu məlumat aşağı etibarlıdır.",
    );
    expect(result.usedLowReliability).toBe(true);
    expect(result.incomplete).toBe(false);
  });

  it("does not add the caveat for an uncited low-reliability result", () => {
    const result = validateCitations(
      `Şirkət investisiya elan etdi [1]⟦E1: ${investmentEvidence}⟧.`,
      sources,
      "aşağı etibar",
    );

    expect(result.answer).toBe("Şirkət investisiya elan etdi [1].");
    expect(result.usedLowReliability).toBe(false);
  });

  it("rejects a real citation when its excerpt contradicts the claimed amount", () => {
    const result = validateCitations(
      "Şirkət 100 milyon ABŞ dolları investisiya elan etdi [2]⟦E2: 50 milyon ABŞ dolları məbləği göstərilib⟧.",
      sources,
      "",
    );
    expect(result.incomplete).toBe(true);
    expect(result.evidenceChecks.unsupportedNumericFactCount).toBeGreaterThan(0);
  });

  it("rejects a fabricated excerpt and a citation with no evidence", () => {
    expect(
      validateCitations("Şirkət investisiya elan etdi [1]⟦E1: uydurma fraqment⟧.", sources, "")
        .incomplete,
    ).toBe(true);
    expect(validateCitations("Şirkət investisiya elan etdi [1].", sources, "").incomplete).toBe(
      true,
    );
  });

  it("requires every factual line to carry its own source and exact excerpt", () => {
    expect(
      validateCitations(
        `Şirkət investisiya elan etdi [1]⟦E1: ${investmentEvidence}⟧.\nLayihə 2025-ci ildə başlayacaq.`,
        sources,
        "",
      ).incomplete,
    ).toBe(true);
  });

  it("accepts multiple claims when each has its own excerpt from the cited chunk", () => {
    const result = validateCitations(
      `Şirkət investisiya elan etdi [1]⟦E1: ${investmentEvidence}⟧.\nLayihə 2025-ci ildə başlayacaq [1]⟦E1: Layihə 2025-ci ildə başlayacaq⟧.`,
      sources,
      "",
    );
    expect(result.incomplete).toBe(false);
    expect(result.evidenceChecks.exactExcerptCount).toBe(2);
  });

  it("fails closed for unsupported factual claims but documents the absence of semantic entailment", () => {
    const result = validateCitations(
      `Şirkət bazarın lideridir [1]⟦E1: ${investmentEvidence}⟧.`,
      sources,
      "",
    );
    // Literal excerpt provenance is not proof that a semantic claim follows from the evidence.
    expect(result.evidenceChecks.exactExcerptCount).toBe(1);
    expect(result.incomplete).toBe(false);
    expect(canPublishAnalyticsAnswer("Şirkət bazarın lideridir [1].", "stop", result)).toBe(true);
  });

  it("rejects contradictory evidence and incorrect numeric claims", () => {
    const result = validateCitations(
      "Şirkət 100 milyon ABŞ dolları investisiya elan etdi [2]⟦E2: 50 milyon ABŞ dolları məbləği göstərilib⟧.",
      sources,
      "",
    );
    expect(result.incomplete).toBe(true);
    expect(result.evidenceChecks.unsupportedNumericFactCount).toBeGreaterThan(0);
  });

  it("rejects invalid citations, missing evidence markers, and unsupported plain claims", () => {
    expect(
      validateCitations("Şirkət investisiya elan etdi [9]⟦E9: naməlum⟧.", sources, "").incomplete,
    ).toBe(true);
    expect(validateCitations("Şirkət investisiya elan etdi [1].", sources, "").incomplete).toBe(
      true,
    );
    expect(validateCitations("Şirkət investisiya elan etdi.", sources, "").incomplete).toBe(true);
  });

  it("marks a no-answer response incomplete when it asserts facts instead of the exact no-sources message", () => {
    expect(validateCitations("Cavab var.", sources, "").incomplete).toBe(true);
    expect(validateCitations("Mənbələrdə məlumat tapılmadı.", [], "").incomplete).toBe(false);
    expect(
      validateCitations("Mənbələrdə məlumat tapılmadı. Şirkət 100 milyon qazandı.", [], "")
        .incomplete,
    ).toBe(true);
  });
});

describe("canPublishAnalyticsAnswer", () => {
  it("checks answer brackets separately from a verified excerpt containing an open bracket", () => {
    const excerpt = "Mənbədə [qeyd verilib";
    const answer = `Mənbədə qeyd var [1]⟦E1: ${excerpt}⟧.`;
    const validation = validateCitations(answer, [{ ...sources[0], text: excerpt }], "");

    expect(validation.incomplete).toBe(false);
    expect(canPublishAnalyticsAnswer(answer, "stop", validation)).toBe(true);
    expect(canPublishAnalyticsAnswer(answer + " [", "stop", validation)).toBe(false);
  });

  it("accepts a completed answer with validated citations", () => {
    expect(
      canPublishAnalyticsAnswer(
        `Şirkət investisiya elan etdi [1]⟦E1: ${investmentEvidence}⟧.`,
        "stop",
        { incomplete: false },
      ),
    ).toBe(true);
  });

  it("rejects truncated output and incomplete citations", () => {
    expect(canPublishAnalyticsAnswer("Nəticə [", "stop", { incomplete: false })).toBe(false);
    expect(canPublishAnalyticsAnswer("Nəticə [1].", "length", { incomplete: false })).toBe(false);
    expect(canPublishAnalyticsAnswer("Nəticə [7].", "stop", { incomplete: true })).toBe(false);
  });

  it.each(["length", "content-filter", "tool-calls", "error", "other", "unknown"])(
    "does not publish a %s completion even when citations are valid",
    (finishReason) => {
      expect(canPublishAnalyticsAnswer("Nəticə [1].", finishReason, { incomplete: false })).toBe(
        false,
      );
    },
  );
});
