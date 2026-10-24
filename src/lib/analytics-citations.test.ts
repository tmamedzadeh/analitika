import { describe, expect, it } from "vitest";
import { analyticsCitedNumbers, analyticsCitationDisplayNumbers } from "./analytics-citations";

const sources = [1, 2, 7, 9].map((n) => ({ n, documentId: "parent", chunkId: `chunk-${n}` }));

describe("frontend analytics citation numbering", () => {
  it("numbers only cited fragments in source order, independently of answer order", () => {
    const cited = analyticsCitedNumbers("Fact [7], then [1][2], again [7].");
    const before = JSON.stringify(sources);
    expect([...analyticsCitationDisplayNumbers(sources, cited)]).toEqual([
      [1, 1],
      [2, 2],
      [7, 3],
    ]);
    expect([
      ...analyticsCitationDisplayNumbers([sources[2]!, sources[0]!], new Set([1, 7])),
    ]).toEqual([
      [7, 1],
      [1, 2],
    ]);
    expect(JSON.stringify(sources)).toBe(before);
    expect([...cited]).toEqual([7, 1, 2]);
  });

  it("gives aliases of one exact chunk one number, while keeping distinct chunks separate", () => {
    const aliases = [...sources.slice(0, 2), { ...sources[0]!, n: 7 }];
    expect([...analyticsCitationDisplayNumbers(aliases, new Set([1, 2, 7]))]).toEqual([
      [1, 1],
      [2, 2],
      [7, 1],
    ]);
  });

  it("leaves sources-only results unnumbered by the citation map", () => {
    expect(analyticsCitationDisplayNumbers(sources, new Set()).size).toBe(0);
  });

  it("does not map revoked or missing sources, or reuse their visible number", () => {
    expect([
      ...analyticsCitationDisplayNumbers(
        [{ ...sources[2]!, available: false }, sources[0]!],
        new Set([1, 7, 99]),
      ),
    ]).toEqual([[1, 1]]);
    // Renumbering original [7] to [2] would collide with the inert original [2].
    expect(
      analyticsCitationDisplayNumbers([sources[0]!, sources[2]!], new Set([1, 2, 7])).size,
    ).toBe(0);
    expect(
      analyticsCitationDisplayNumbers(
        [sources[0]!, { ...sources[1]!, available: false }, sources[2]!],
        new Set([1, 2, 7]),
      ).size,
    ).toBe(0);
  });

  it("fails safe for ambiguous numbers, unidentified records and parent-only fragment aliases", () => {
    for (const damaged of [
      [sources[2]!, { ...sources[2]!, chunkId: "conflict" }],
      [{ n: 7 }],
      [
        { n: 1, documentId: "legacy" },
        { n: 7, documentId: "legacy" },
      ],
    ])
      expect(analyticsCitationDisplayNumbers(damaged, new Set([1, 7])).size).toBe(0);
    expect([
      ...analyticsCitationDisplayNumbers([{ n: 7, documentId: "legacy" }], new Set([7])),
    ]).toEqual([[7, 1]]);
  });

  it("recognizes citations in paragraphs, emphasis, lists, tables and numeric citation links", () => {
    const answer =
      "## Summary [1]\n\n**Fact [2]**\n\n- Fact [7]\n\n| Fact | Source |\n| --- | --- |\n| A | [9] |\n\n[11](https://untrusted.test)";
    expect([...analyticsCitedNumbers(answer)]).toEqual([1, 2, 7, 9, 11]);
  });

  it("does not recognize numbers in code, ordinary links, images, definitions or escaped text", () => {
    const answer = [
      "2026 and `code [7]`.",
      "```text\n[7]\n```",
      "[Report [7]](https://example.test/[7])",
      "![Image [7]](https://example.test/image.png)",
      "[7][report]\n\n[report]: https://example.test",
      "\\[7] and [07] and [9007199254740992]",
    ].join("\n\n");
    expect([...analyticsCitedNumbers(answer)]).toEqual([]);
  });
});
