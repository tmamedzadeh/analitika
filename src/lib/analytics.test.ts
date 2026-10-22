import { describe, expect, it } from "vitest";

import {
  analyticsSourceCounts,
  analyticsSourceGroupKey,
  citedSourceNumbers,
  groupAnalyticsSources,
  type AnalyticsSourcePreview,
} from "./analytics";

function source(
  overrides: Partial<AnalyticsSourcePreview> & { n: number },
): AnalyticsSourcePreview {
  return {
    sourceKind: overrides.sourceKind ?? "document",
    chunkId: overrides.chunkId ?? `chunk-${overrides.n}`,
    documentId:
      overrides.documentId ?? (overrides.sourceKind === "brief" ? null : `document-${overrides.n}`),
    briefId: null,
    title: `Material ${overrides.n}`,
    docDate: "2026-10-21",
    briefDate: null,
    direction: "OSINT",
    sectionTitle: "Section",
    quote: `Excerpt ${overrides.n}`,
    isTable: false,
    attachmentCount: 0,
    sourceReliability: "B",
    infoCredibility: 3,
    classification: "open",
    ...overrides,
  };
}

describe("analytics source grouping", () => {
  it("keeps three chunks of one document in a single card with three fragments", () => {
    const groups = groupAnalyticsSources([
      source({ n: 1, chunkId: "a-1", documentId: "document-a" }),
      source({ n: 3, chunkId: "a-2", documentId: "document-a" }),
      source({ n: 6, chunkId: "a-3", documentId: "document-a" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("document:document-a");
    expect(groups[0]!.displayedChunkCount).toBe(3);
    expect(groups[0]!.citedNumbers).toEqual([1, 3, 6]);
    expect(groups[0]!.chunks.map((chunk) => chunk.n)).toEqual([1, 3, 6]);
  });

  it("keeps six chunks from three documents in three cards with six fragments", () => {
    const groups = groupAnalyticsSources([
      source({ n: 1, documentId: "a", chunkId: "a-1" }),
      source({ n: 2, documentId: "a", chunkId: "a-2" }),
      source({ n: 3, documentId: "b", chunkId: "b-1" }),
      source({ n: 4, documentId: "b", chunkId: "b-2" }),
      source({ n: 5, documentId: "c", chunkId: "c-1" }),
      source({ n: 6, documentId: "c", chunkId: "c-2" }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["document:a", "document:b", "document:c"]);
    expect(groups.map((group) => group.displayedChunkCount)).toEqual([2, 2, 2]);
    expect(analyticsSourceCounts(groups.flatMap((group) => group.chunks))).toEqual({
      materials: 3,
      fragments: 6,
    });
  });

  it("never merges a document and a brief even with the same ID or title", () => {
    const sameId = "00000000-0000-4000-8000-000000000001";
    const groups = groupAnalyticsSources([
      source({ n: 1, documentId: sameId, title: "Same title" }),
      source({
        n: 2,
        sourceKind: "brief",
        documentId: null,
        briefId: sameId,
        title: "Same title",
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key)).toEqual([`document:${sameId}`, `brief:${sameId}`]);
    expect(groups.map((group) => group.sourceKind)).toEqual(["document", "brief"]);
  });

  it("does not merge different documents that share a title or date", () => {
    const groups = groupAnalyticsSources([
      source({ n: 1, documentId: "a", title: "Identical", docDate: "2026-10-21" }),
      source({ n: 2, documentId: "b", title: "Identical", docDate: "2026-10-21" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("counts a repeated chunk once and ignores a chunk that was never cited", () => {
    const sources = [
      source({ n: 1, documentId: "a", chunkId: "a-1" }),
      source({ n: 1, documentId: "a", chunkId: "a-1" }),
      source({ n: 2, documentId: "a", chunkId: "a-1" }),
      source({ n: 9, documentId: "z", chunkId: "z-1" }),
    ];
    const cited = citedSourceNumbers("Answer [1][2]. [1] appears again.");
    expect(cited.has(9)).toBe(false);
    const groups = groupAnalyticsSources(sources, cited);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.displayedChunkCount).toBe(1);
    expect(groups[0]!.citedNumbers).toEqual([1, 2]);
    expect(analyticsSourceCounts(sources, cited)).toEqual({ materials: 1, fragments: 1 });
    // Retrieved counts stay independent of what the answer cited.
    expect(analyticsSourceCounts(sources)).toEqual({ materials: 2, fragments: 2 });
  });

  it("separates sources without a parent ID instead of guessing a group", () => {
    expect(
      analyticsSourceGroupKey(
        source({ n: 4, documentId: null, briefId: null, chunkId: "orphan-1" }),
      ),
    ).toBe("chunk:document:orphan-1");
    const groups = groupAnalyticsSources([
      source({ n: 4, documentId: null, briefId: null, chunkId: "orphan-1" }),
      source({ n: 5, documentId: null, briefId: null, chunkId: "orphan-2" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("groups legacy identities by their IDs while honoring an explicit material type", () => {
    const groups = groupAnalyticsSources([
      { n: 1, chunkId: "a", briefId: "same" },
      { n: 3, chunkId: "b", briefId: "same" },
      { n: 6, chunkId: "c", documentId: "same" },
      { n: 7, chunkId: "c", sourceKind: "brief" as const, documentId: "same" },
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      "brief:same",
      "document:same",
      "chunk:brief:c",
    ]);
    expect(groups.map((group) => group.sourceKind)).toEqual(["brief", "document", "brief"]);
    expect(groups[0]!.citedNumbers).toEqual([1, 3]);
  });

  it("retains every original citation alias while counting its chunk once", () => {
    const sources = [
      source({ n: 1, chunkId: "shared", documentId: "a" }),
      source({ n: 3, chunkId: "shared", documentId: "a" }),
    ];
    const [group] = groupAnalyticsSources(sources);
    expect(group!.citedNumbers).toEqual([1, 3]);
    expect(group!.citationChunks.get(1)).toBe(group!.citationChunks.get(3));
    expect(group!.chunks).toHaveLength(1);
    expect(groupAnalyticsSources(sources, new Set([3]))[0]!.chunks[0]!.n).toBe(3);
  });

  it("keeps the first server mapping if a damaged snapshot repeats a number", () => {
    const sources = [source({ n: 1, documentId: "first" }), source({ n: 1, documentId: "other" })];
    expect(groupAnalyticsSources(sources).map((group) => group.key)).toEqual(["document:first"]);
    expect(analyticsSourceCounts(sources)).toEqual({ materials: 1, fragments: 1 });
  });
});
