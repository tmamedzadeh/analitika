import { describe, expect, it } from "vitest";

import { canPublishAnalyticsAnswer, validateCitations } from "./citations";

const sources = [
  { n: 1, sourceReliability: "A", infoCredibility: 1 },
  { n: 2, sourceReliability: "D", infoCredibility: 5 },
] as const;

describe("validateCitations", () => {
  it("removes unknown citations and marks the answer incomplete", () => {
    const result = validateCitations("Fakt [1], naməlum istinad [7].", sources, "aşağı etibar");

    expect(result.answer).toBe("Fakt [1], naməlum istinad .");
    expect(result.incomplete).toBe(true);
    expect(result.usedLowReliability).toBe(false);
  });

  it("adds the Azerbaijani caveat when a low-reliability source is cited", () => {
    const result = validateCitations("Bu məlumat [2].", sources, "bu məlumat aşağı etibarlıdır");

    expect(result.answer).toBe("Bu məlumat [2].\n\nbu məlumat aşağı etibarlıdır.");
    expect(result.usedLowReliability).toBe(true);
    expect(result.incomplete).toBe(false);
  });

  it("does not add the caveat for an uncited low-reliability result", () => {
    const result = validateCitations("Təsdiqlənmiş məlumat [1].", sources, "aşağı etibar");

    expect(result.answer).toBe("Təsdiqlənmiş məlumat [1].");
    expect(result.usedLowReliability).toBe(false);
  });

  it.each(["[1, 2]", "[1,2]", "[1; 2]", "[1–2]", "[1-2]"])(
    "normalizes citation group %s into adjacent citations",
    (citation) => {
      const result = validateCitations(`Fakt ${citation}.`, sources, "aşağı etibar");
      expect(result.answer).toBe("Fakt [1][2].\n\naşağı etibar.");
      expect(result.incomplete).toBe(false);
      expect(result.usedLowReliability).toBe(true);
    },
  );

  it("removes unknown numbers in groups and ranges and marks the answer incomplete", () => {
    const result = validateCitations("Fakt [1, 7] və [1–3].", sources, "aşağı etibar");
    expect(result.answer).toBe("Fakt [1] və [1][2].\n\naşağı etibar.");
    expect(result.incomplete).toBe(true);
  });

  it("marks an answer without citations incomplete except for the no-sources message", () => {
    expect(validateCitations("Cavab var.", sources, "").incomplete).toBe(true);
    expect(validateCitations("Mənbələrdə məlumat tapılmadı.", [], "").incomplete).toBe(false);
  });
});

describe("canPublishAnalyticsAnswer", () => {
  it("accepts a completed answer with validated citations", () => {
    expect(canPublishAnalyticsAnswer("Nəticə [1].", "stop", { incomplete: false })).toBe(true);
  });

  it("rejects truncated output and incomplete citations", () => {
    expect(canPublishAnalyticsAnswer("Nəticə [", "stop", { incomplete: false })).toBe(false);
    expect(canPublishAnalyticsAnswer("Nəticə [1].", "length", { incomplete: false })).toBe(false);
    expect(canPublishAnalyticsAnswer("Nəticə [7].", "stop", { incomplete: true })).toBe(false);
  });
});
