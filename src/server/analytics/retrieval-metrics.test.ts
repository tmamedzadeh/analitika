import { describe, expect, it } from "vitest";
import { retrievalMetrics } from "./retrieval-metrics";

const doc = (id: string) => ({ documentId: id, briefId: null });
describe("source retrieval metrics", () => {
  it("penalizes missing gold sources in nDCG rather than normalizing against retrieved hits", () => {
    const score = retrievalMetrics([doc("a")], new Set(["document:a", "document:b"]));
    expect(score.recall10).toBe(0.5);
    expect(score.ndcg).toBeCloseTo(1 / (1 + 1 / Math.log2(3)));
  });
  it("does not reward duplicate chunks from a source twice", () => {
    const score = retrievalMetrics(
      [doc("a"), doc("a"), doc("b")],
      new Set(["document:a", "document:b"]),
    );
    expect(score.ndcg).toBeCloseTo(1.5 / (1 + 1 / Math.log2(3)));
    expect(score.recall5).toBe(1);
  });
  it("uses chunk positions for cutoffs and reciprocal rank", () => {
    const score = retrievalMetrics(
      [...Array.from({ length: 5 }, () => doc("x")), doc("a")],
      new Set(["document:a"]),
    );
    expect(score.recall5).toBe(0);
    expect(score.recall10).toBe(1);
    expect(score.mrr).toBe(1 / 6);
  });
  it("keeps empty and no-answer cases finite and separate", () => {
    expect(retrievalMetrics([], new Set())).toEqual({ recall5: 0, recall10: 0, mrr: 0, ndcg: 0 });
  });
});
