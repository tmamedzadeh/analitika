import { describe, expect, it } from "vitest";
import { asSource, contextFixture, contextId } from "@/test/fixtures/analytics-context";
import { additionalContextPayload, selectAuxiliaryContext, textBytes } from "./context-selection";
import { buildAnalyticsPrompt } from "../prompts/analytics";
import { analyticsSourceCounts } from "@/lib/analytics";

describe("conservative boundary context selection", () => {
  it("selects before/after boundary continuations, strips overlap and independent sentences", () => {
    const { sources, primary, neighbors } = contextFixture();
    const auxiliary = selectAuxiliaryContext(sources, primary, neighbors);
    expect(auxiliary.map((item) => item.position)).toEqual(["before", "after"]);
    expect(auxiliary.map((item) => item.text).join(" ")).not.toMatch(/999|alien|Independent/);
    expect(auxiliary.every((item) => !Object.hasOwn(item, "n"))).toBe(true);
    const base = buildAnalyticsPrompt("question", sources);
    expect(buildAnalyticsPrompt("question", sources, "medium", [])).toEqual(base);
    const expanded = buildAnalyticsPrompt("question", sources, "medium", auxiliary);
    expect(expanded.prompt).toContain("Citable Evidence");
    expect(expanded.prompt).toContain("Auxiliary Context (not citable)");
    expect(expanded.system).toContain(
      "Every factual claim must be supported by the original numbered evidence itself",
    );
    expect(expanded.prompt).not.toMatch(/999|alien|Independent|\[3\]/);
    expect(expanded.prompt).toContain(sources[0]!.text);
    expect(analyticsSourceCounts(sources)).toEqual({ materials: 2, fragments: 2 });
    const payload = additionalContextPayload(sources, auxiliary);
    expect(
      expanded.prompt.length + expanded.system.length - base.prompt.length - base.system.length,
    ).toBe(payload.length);
  });

  it.each(["table", "blank_section", "section", "parent", "model", "ord", "offset", "overlap"])(
    "skips unsafe %s neighbors",
    (kind) => {
      const { sources, primary, neighbors } = contextFixture();
      const neighbor = { ...neighbors[0]! };
      if (kind === "table") neighbor.isTable = true;
      if (kind === "blank_section") {
        primary[0]!.sectionTitle = "";
        neighbor.sectionTitle = "";
      }
      if (kind === "section") neighbor.sectionTitle = "Unrelated";
      if (kind === "parent") neighbor.documentId = contextId(999);
      if (kind === "model") neighbor.embeddingModel = "old";
      if (kind === "ord") neighbor.ord = 4;
      if (kind === "offset") neighbor.charStart++;
      if (kind === "overlap") neighbor.text = neighbor.text.slice(0, -1) + "X";
      expect(selectAuxiliaryContext(sources, primary, [neighbor])).toEqual([]);
    },
  );

  it.each(["999", "NewEntity", "exports"])(
    "does not widen evidence with auxiliary-only %s",
    (fact) => {
      const { sources, primary, neighbors } = contextFixture();
      const neighbor = neighbors[0]!;
      // Change only the candidate continuation, preserving its length and the exact overlap.
      neighbor.text = neighbor.text.replace(
        "The production plant operates steadily with synthetic capacity ",
        `${fact} production plant operates steadily with synthetic capacity `,
      );
      neighbor.charStart = neighbor.charEnd - neighbor.text.length;
      expect(selectAuxiliaryContext(sources, primary, [neighbor])).toEqual([]);
    },
  );

  it("handles first/last chunks and skips short, duplicated or already retrieved context", () => {
    const { sources, primary, neighbors } = contextFixture();
    expect(selectAuxiliaryContext(sources, primary, [neighbors[0]!])).toHaveLength(1);
    primary[0]!.ord = 0;
    neighbors[1]!.ord = 1;
    expect(selectAuxiliaryContext(sources, primary, [neighbors[1]!])).toHaveLength(1);
    primary[0]!.text = "short";
    expect(selectAuxiliaryContext(sources, primary, neighbors)).toEqual([]);
    const original = contextFixture();
    expect(
      selectAuxiliaryContext(original.sources, original.primary, [
        original.neighbors[0]!,
        original.neighbors[0]!,
      ]),
    ).toEqual([]);
    expect(
      selectAuxiliaryContext(
        [...original.sources, asSource(original.neighbors[0]!, 3)],
        original.primary,
        [original.neighbors[0]!],
      ),
    ).toEqual([]);
  });

  it("caps anchors at three, neighbors at three and all additive prompt content at 20%/2400 bytes", () => {
    const fixture = contextFixture();
    const primary = Array.from({ length: 4 }, (_, index) => ({
      ...fixture.primary[0]!,
      id: contextId(index + 10),
      documentId: contextId(index + 110),
    }));
    const sources = primary.map((chunk, index) => asSource(chunk, index + 1));
    const neighbors = primary.flatMap((anchor, index) =>
      fixture.neighbors.map((chunk, direction) => ({
        ...chunk,
        id: contextId(30 + index * 2 + direction),
        documentId: anchor.documentId,
      })),
    );
    // Different boundary word orders avoid duplicate auxiliary excerpts across anchors.
    neighbors[2]!.text = neighbors[2]!.text.replace(
      "The production plant operates steadily with synthetic capacity ",
      "The synthetic capacity plant operates steadily with production ",
    );
    neighbors[2]!.charStart = neighbors[2]!.charEnd - neighbors[2]!.text.length;
    const selected = selectAuxiliaryContext(sources, primary, neighbors);
    expect(selected).toHaveLength(3);
    expect(selected.some((item) => item.anchorChunkId === primary[3]!.id)).toBe(false);
    const payload = additionalContextPayload(sources, selected);
    const base = sources.map((source) => source.text).join("");
    expect(payload.length).toBeLessThanOrEqual(Math.floor(base.length * 0.2));
    expect(textBytes(payload)).toBeLessThanOrEqual(
      Math.min(2400, Math.floor(textBytes(base) * 0.2)),
    );
    expect(selectAuxiliaryContext([sources[0]!], [primary[0]!], neighbors)).toEqual([]);
  });
});
