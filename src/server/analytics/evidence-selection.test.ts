import { describe, expect, it } from "vitest";
import { analyticsSourceGroupKey, groupAnalyticsSources } from "@/lib/analytics";
import { asSource, contextFixture, contextId } from "@/test/fixtures/analytics-context";
import { buildAnalyticsPrompt } from "../prompts/analytics";
import { formatAnalyticsEvidence } from "../prompts/analytics-evidence";
import { validateCitations } from "./citations";
import { buildAnalyticsHistorySnapshot } from "./history";
import { EVIDENCE_CONTEXT_BYTE_LIMIT, EVIDENCE_CONTEXT_CHAR_LIMIT } from "./evidence-limits";
import {
  EvidenceContextBudgetError,
  fitsEvidenceContext,
  selectAnalyticsEvidence,
} from "./evidence-selection";

const anchor = contextFixture().primary[0]!;
const source = (
  index: number,
  parent = index,
  text = `Plant output in district ${index} reached ${index + 40} units.`,
) =>
  asSource(
    {
      ...anchor,
      id: contextId(index + 1),
      documentId: contextId(100 + parent),
      text,
      charEnd: anchor.charStart + text.length,
    },
    index + 101,
  );

describe("source-aware evidence selection", () => {
  it("keeps cross-material provenance and twenty UUIDs while transmitting identical text only once", () => {
    const text = "Plant output logistics capacity operations supply deliveries. ".repeat(150);
    const pool = Array.from({ length: 20 }, (_, index) => source(index, index, text));
    const before = structuredClone(pool);
    const selected = selectAnalyticsEvidence("plant output", pool);
    expect(selected).toHaveLength(20);
    expect(groupAnalyticsSources(selected)).toHaveLength(20);
    expect(selected.map((item) => item.chunkId)).toEqual(pool.map((item) => item.chunkId));
    expect(selected.every((item) => item.text === text)).toBe(true);
    const rendered = formatAnalyticsEvidence(selected);
    expect(rendered.split(text)).toHaveLength(2);
    expect(rendered.match(/bu uyğunluq müstəqil təsdiq demək deyil/gu)).toHaveLength(19);
    expect(fitsEvidenceContext(selected)).toBe(true);
    expect(text.length * 20).toBeGreaterThan(EVIDENCE_CONTEXT_CHAR_LIMIT);
    const saved = buildAnalyticsHistorySnapshot(
      selected,
      "Details [1][20].",
      "synthetic",
      0,
      new Date("2026-10-23"),
    );
    expect(saved.snapshots.map((item) => [item.n, item.documentId, item.chunkId])).toEqual(
      selected.map((item) => [item.n, item.documentId, item.chunkId]),
    );
    expect(pool).toEqual(before);
  });

  it("keeps separate document and brief origins for normalized copies without copying the body", () => {
    const first = source(0);
    const copy = {
      ...source(1, 1, first.text.replaceAll(" ", "\n ")),
      sourceKind: "brief" as const,
      documentId: null,
      briefId: first.documentId,
    };
    const selected = selectAnalyticsEvidence("plant output", [first, copy]);
    expect(selected.map((item) => item.chunkId)).toEqual([first.chunkId, copy.chunkId]);
    expect(groupAnalyticsSources(selected)).toHaveLength(2);
    const rendered = formatAnalyticsEvidence(selected);
    expect(rendered).toContain("Mətn [1] fraqmenti ilə eynidir");
    expect(rendered).not.toContain(copy.text);
    expect(selected[1]!.text).toBe(copy.text);
    expect(validateCitations("Details [1][2].", selected).incomplete).toBe(false);
  });
  it("allows twenty distinct materials without a ten-material quota, bounded to twenty chunks", () => {
    const pool = Array.from({ length: 30 }, (_, index) => source(index));
    const result = selectAnalyticsEvidence("plant output", pool);
    expect(result).toHaveLength(20);
    expect(new Set(result.map(analyticsSourceGroupKey)).size).toBe(20);
    expect(result.map((item) => item.chunkId)).toEqual(
      pool.slice(0, 20).map((item) => item.chunkId),
    );
  });

  it("allows twenty useful chunks from one material without a per-document cap", () => {
    const pool = Array.from({ length: 20 }, (_, index) => source(index, 0));
    const result = selectAnalyticsEvidence("plant output", pool);
    expect(result).toHaveLength(20);
    expect(groupAnalyticsSources(result)).toHaveLength(1);
  });

  it("prefers one or two useful chunks per material by dropping repeated content", () => {
    const first = source(0, 0);
    const second = source(1, 1);
    const third = source(2, 2);
    const pool = [
      first,
      source(3, 0, first.text),
      source(4, 0, first.text + "  "),
      second,
      source(5, 1, second.text),
      source(6, 1, second.text),
      third,
      source(7, 2, third.text),
    ];
    expect(selectAnalyticsEvidence("plant output", pool).map((item) => item.chunkId)).toEqual(
      [first, second, third].map((item) => item.chunkId),
    );
  });

  it("keeps a strong document's second chunk ahead of a weaker new material", () => {
    const strong = [source(0, 0), source(1, 0)];
    const weak = {
      ...source(2),
      title: "Gardening",
      sectionTitle: "Flowers",
      text: "Flowers grow in the garden.",
    };
    const result = selectAnalyticsEvidence("plant output", [...strong, weak]);
    expect(result.map((item) => item.chunkId)).toEqual(strong.map((item) => item.chunkId));
  });

  it("stops at one sufficient factual source when the remainder are copies or unrelated lexical candidates", () => {
    const first = source(0, 0, "Plant output was 42 units in October.");
    const unrelated = {
      ...source(2),
      title: "Weather",
      sectionTitle: "Forecast",
      text: "Rain is expected tomorrow.",
    };
    expect(
      selectAnalyticsEvidence("plant output", [first, source(1, 0, first.text), unrelated]),
    ).toEqual([{ ...first, n: 1 }]);
  });

  it("preserves vector-supported synonyms and same-material detail without direct query words", () => {
    const first = source(0);
    const detail = {
      ...source(1, 0),
      title: "Report",
      sectionTitle: "Detail",
      text: "A bottleneck delays deliveries.",
    };
    const semantic = {
      ...source(2),
      title: "Report",
      sectionTitle: "Capacity",
      text: "The factory manufactured forty units.",
    };
    const pool = [first, detail, semantic];
    expect(selectAnalyticsEvidence("plant output", pool, new Set([semantic.chunkId]))).toHaveLength(
      3,
    );
    // With no lexical bridge at all, the original leading semantic evidence remains usable.
    expect(selectAnalyticsEvidence("manufacturing capacity", [semantic])).toHaveLength(1);
  });

  it("requires more new content from the third chunk and retains changed quantities, names and negation", () => {
    const body =
      "plant output logistics capacity operations supply deliveries contracts stock maintenance readiness transport "
        .repeat(10)
        .trim();
    const first = source(0, 0, body);
    const second = source(
      1,
      0,
      body +
        "\nnew independent detail about infrastructure and repair facilities near the coast".repeat(
          8,
        ),
    );
    const lowNovelty = source(2, 0, body + "\nsmall additional commentary");
    const number = source(3, 0, body + "\n42 units");
    const name = source(4, 0, body + "\nBaku depot");
    const negation = source(5, 0, body + "\nnot confirmed");
    const result = selectAnalyticsEvidence("plant output", [
      first,
      second,
      lowNovelty,
      number,
      name,
      negation,
    ]);
    expect(result.map((item) => item.chunkId)).toEqual(
      [first, second, number, name, negation].map((item) => item.chunkId),
    );
  });

  it("deduplicates UUIDs and normalized copies, preserves stable input order and never mutates input", () => {
    const first = source(0);
    const pool = [
      first,
      { ...first },
      source(1, 0, first.text.replaceAll(" ", "\n ")),
      source(2),
      source(3),
    ];
    const before = structuredClone(pool);
    const selected = selectAnalyticsEvidence("plant output", pool);
    expect(selected.map((item) => item.chunkId)).toEqual([
      first.chunkId,
      pool[3]!.chunkId,
      pool[4]!.chunkId,
    ]);
    expect(selectAnalyticsEvidence("plant output", pool)).toEqual(selected);
    expect(pool).toEqual(before);
  });

  it("uses source kind and UUID even when titles and parent UUIDs coincide", () => {
    const document = source(0);
    const brief = {
      ...source(1),
      sourceKind: "brief" as const,
      documentId: null,
      briefId: document.documentId,
    };
    const other = source(2);
    const result = selectAnalyticsEvidence("plant output", [document, brief, other]);
    expect(groupAnalyticsSources(result)).toHaveLength(3);
  });

  it.each(["a", "я", "😀", "界"])(
    "budgets complete chunks, growing same-parent labels and UTF-8 bytes (%s)",
    (character) => {
      const pool = Array.from({ length: 30 }, (_, index) =>
        source(index, 0, `Plant ${index}: ` + character.repeat(1700)),
      );
      const result = selectAnalyticsEvidence("plant", pool);
      const rendered = "Mənbə fraqmentləri:\n" + formatAnalyticsEvidence(result);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(20);
      expect(rendered.length).toBeLessThanOrEqual(EVIDENCE_CONTEXT_CHAR_LIMIT);
      expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(EVIDENCE_CONTEXT_BYTE_LIMIT);
      expect(
        fitsEvidenceContext([...result, { ...pool[result.length]!, n: result.length + 1 }]),
      ).toBe(false);
      for (const item of result)
        expect(item.text).toBe(pool.find((candidate) => candidate.chunkId === item.chunkId)!.text);
    },
  );

  it("counts long metadata and skips an oversized whole chunk so smaller useful evidence can fit", () => {
    const first = source(0);
    const huge = { ...source(1), title: "large title ".repeat(3000) };
    const last = source(2);
    expect(
      selectAnalyticsEvidence("plant output", [first, huge, last]).map((item) => item.chunkId),
    ).toEqual([first.chunkId, last.chunkId]);
    expect(() =>
      selectAnalyticsEvidence("plant", [{ ...first, text: "x".repeat(50_000) }]),
    ).toThrow(EvidenceContextBudgetError);
    expect(selectAnalyticsEvidence("plant", [source(3, 0, "  \n ")])).toEqual([]);
  });

  it("binds citations 1–20, prompt relationships and history snapshots to the selected UUIDs", () => {
    const result = selectAnalyticsEvidence(
      "plant output",
      Array.from({ length: 20 }, (_, index) => source(index, index % 10)),
    );
    const answer = result.map((item) => `Detail [${item.n}].`).join(" ");
    expect(result.map((item) => item.n)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(validateCitations(answer, result).incomplete).toBe(false);
    expect(validateCitations("Unknown [21].", result).incomplete).toBe(true);
    const prompt = buildAnalyticsPrompt("plant output", result);
    expect(prompt.prompt).toContain("Eyni ilkin materialın fraqmentləri: [10], [20].");
    expect(prompt.prompt).not.toContain("Auxiliary Context");
    const snapshot = buildAnalyticsHistorySnapshot(
      result,
      answer,
      "synthetic",
      0,
      new Date("2026-10-23"),
    );
    expect(snapshot.snapshots.map((item) => [item.n, item.chunkId])).toEqual(
      result.map((item) => [item.n, item.chunkId]),
    );
    expect(snapshot.snapshots.every((item) => item.usedInAnswer)).toBe(true);
    expect(snapshot.snapshots[0]).not.toHaveProperty("contextChunks");
  });
});
