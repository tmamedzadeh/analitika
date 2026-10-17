import { describe, expect, it } from "vitest";

import { reciprocalRankFusion } from "./ranking";

describe("reciprocalRankFusion", () => {
  it("combines ranks from independent result lists and keeps the first item payload", () => {
    const result = reciprocalRankFusion(
      [
        [
          { id: "shared", label: "vector" },
          { id: "vector-only", label: "vector" },
        ],
        [
          { id: "shared", label: "full text" },
          { id: "text-only", label: "full text" },
        ],
      ],
      60,
    );

    expect(result.map(({ item }) => item.id)).toEqual(["shared", "vector-only", "text-only"]);
    expect(result[0]?.item.label).toBe("vector");
    expect(result[0]?.score).toBeCloseTo(2 / 61);
  });

  it("does not count duplicate IDs twice inside one ranked list", () => {
    const result = reciprocalRankFusion([[{ id: "same" }, { id: "same" }]], 60);

    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBeCloseTo(1 / 61);
  });
});
