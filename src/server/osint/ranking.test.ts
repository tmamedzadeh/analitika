import { describe, expect, it } from "vitest";

import type { OsintLanguage } from "@/lib/osint";
import {
  assignSemanticRelevance,
  cosineSimilarity,
  dedupeSearchSources,
  hasLanguageSourceCoverage,
  reciprocalRankFusion,
  selectWithMmr,
  type RankedCandidate,
} from "./ranking";

function candidate(
  language: OsintLanguage,
  url: string,
  domain: string,
  relevance: number,
  vector: number[],
): RankedCandidate {
  return {
    url,
    title: "Report about regional security " + url,
    domain,
    language,
    text: "Regional security developments and official statements.",
    index: 1,
    semanticRelevance: relevance,
    vector,
  };
}

describe("OSINT ranking and merge", () => {
  it("checks the minimum per-language source coverage", () => {
    const sources = [
      { url: "https://one.example", title: "First", index: 1 },
      { url: "https://two.example", title: "Second", index: 2 },
    ];
    expect(hasLanguageSourceCoverage(sources, "en")).toBe(true);
    expect(hasLanguageSourceCoverage(sources.slice(0, 1), "en")).toBe(false);
  });

  it("merges providers with RRF k=60 and keeps provider provenance", () => {
    const merged = reciprocalRankFusion([
      {
        provider: "exa",
        results: [{ url: "https://www.example.org/story/?utm_source=a", title: "Story", index: 1 }],
      },
      {
        provider: "tavily",
        results: [{ url: "https://example.org/story", title: "Story copy", index: 2 }],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.providers).toEqual(["exa", "tavily"]);
    expect(merged[0]?.rrfScore).toBeCloseTo(1 / 61 + 1 / 62);
  });

  it("uses cosine relevance and falls back to simple language-aware lexical relevance", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    const embedded = candidate("en", "https://a.org", "a.org", 0, [1, 0]);
    embedded.queryVector = [1, 0];
    const lexical: RankedCandidate = {
      url: "https://b.org",
      title: "Report about regional security",
      domain: "b.org",
      language: "en",
      text: "Regional security developments and official statements.",
      index: 1,
      semanticRelevance: 0,
      relevanceQuery: "regional security",
    };
    expect(
      assignSemanticRelevance("unrelated", [embedded, lexical]).map(
        (item) => item.semanticRelevance,
      ),
    ).toEqual([1, 1]);
  });

  it("keeps qualified two-source language coverage and respects domain and relevance limits", () => {
    const items = [
      candidate("fa", "https://one.example/fa1", "one.example", 0.9, [1, 0]),
      candidate("fa", "https://two.example/fa2", "two.example", 0.8, [0.8, 0.2]),
      candidate("hy", "https://one.example/hy1", "one.example", 0.95, [0.9, 0.1]),
      candidate("hy", "https://three.example/hy2", "three.example", 0.7, [0, 1]),
      candidate("ru", "https://four.example/ru", "four.example", 0.17, [0.2, 0.8]),
    ];
    const selected = selectWithMmr(items, { threshold: 0.18, maxPerDomain: 2, maxSelected: 4 });
    expect(selected.filter((item) => item.language === "fa")).toHaveLength(2);
    expect(selected.filter((item) => item.language === "hy")).toHaveLength(2);
    expect(selected.some((item) => item.language === "ru")).toBe(false);
    const domainCounts = new Map<string, number>();
    for (const item of selected)
      domainCounts.set(item.domain, (domainCounts.get(item.domain) ?? 0) + 1);
    expect([...domainCounts.values()].every((count) => count <= 2)).toBe(true);
  });

  it("enforces the configured source limit per domain", () => {
    const items = [
      candidate("en", "https://same.example/1", "same.example", 0.9, [1, 0]),
      candidate("en", "https://same.example/2", "same.example", 0.8, [0.9, 0.1]),
      candidate("en", "https://other.example/3", "other.example", 0.7, [0, 1]),
    ];
    const selected = selectWithMmr(items, { maxPerDomain: 1, maxSelected: 5 });
    expect(selected.filter((item) => item.domain === "same.example")).toHaveLength(1);
  });

  it("deduplicates normalized URLs and obvious title copies", () => {
    const sources = [
      {
        url: "https://www.example.org/story/?utm_campaign=x",
        title: "Regional security report",
        index: 1,
      },
      { url: "https://example.org/story", title: "Regional security report", index: 2 },
      { url: "https://copy.example.net/story", title: "Report on regional security", index: 3 },
    ];
    expect(dedupeSearchSources(sources)).toHaveLength(1);
  });
});
