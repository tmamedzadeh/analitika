import { describe, expect, it } from "vitest";

import { validateCitations } from "./citations";

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
});
