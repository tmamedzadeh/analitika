import { describe, expect, it } from "vitest";

import { reciprocalRankFusion, resolveQueryEmbedding, settleRetrievalBranches } from "./ranking";

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

  it("keeps independently useful chunks from the same document", () => {
    const result = reciprocalRankFusion([
      [
        { id: "doc-a:chunk-1", documentId: "doc-a" },
        { id: "doc-a:chunk-2", documentId: "doc-a" },
      ],
    ]);
    expect(result.map(({ item }) => item.id)).toEqual(["doc-a:chunk-1", "doc-a:chunk-2"]);
  });
});

describe("settleRetrievalBranches", () => {
  it("keeps successful branch results when another branch fails", async () => {
    const result = await settleRetrievalBranches([
      { name: "full_text", run: async () => ["match"] },
      { name: "vector", run: async () => Promise.reject(new Error("provider down")) },
    ]);
    expect(result.results).toEqual([["match"]]);
    expect(result.failed).toEqual(["vector"]);
  });

  it("throws when every attempted branch fails", async () => {
    await expect(
      settleRetrievalBranches([
        { name: "full_text", run: async () => Promise.reject(new Error("db down")) },
      ]),
    ).rejects.toThrow("All analytics retrieval branches failed");
  });
});

describe("query embedding fallback", () => {
  it("keeps lexical search available when embedding fails", async () => {
    await expect(
      resolveQueryEmbedding({
        dimensions: 3,
        embed: async () => Promise.reject(new Error("provider down")),
      }),
    ).resolves.toEqual({ failure: "provider_error" });
  });

  it("rejects wrong-sized and non-finite vectors", async () => {
    await expect(
      resolveQueryEmbedding({ dimensions: 3, provided: [1, 2], embed: async () => [] }),
    ).resolves.toEqual({ failure: "invalid_vector" });
    await expect(
      resolveQueryEmbedding({ dimensions: 2, provided: [1, Number.NaN], embed: async () => [] }),
    ).resolves.toEqual({ failure: "invalid_vector" });
  });

  it("accepts a finite vector with the configured schema dimension", async () => {
    await expect(
      resolveQueryEmbedding({ dimensions: 3, provided: [0.1, -0.2, 0.3], embed: async () => [] }),
    ).resolves.toEqual({ embedding: [0.1, -0.2, 0.3] });
  });
});
