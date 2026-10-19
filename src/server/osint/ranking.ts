import type { OsintLanguage } from "@/lib/osint";
import type { SearchProviderId, SearchSource } from "../ai/types";
import { matchesOsintLanguageScript, normalizeOsintUrl, similarOsintTitle } from "./urls";

export const RRF_K = 60;

export type RankedCandidate = SearchSource & {
  domain: string;
  language: OsintLanguage;
  text: string;
  semanticRelevance: number;
  vector?: number[];
  queryVector?: number[];
  rrfScore?: number;
  relevanceQuery?: string;
  providerFullText?: boolean;
};

export type SearchResultSet = {
  provider: SearchProviderId;
  results: SearchSource[];
};

function contentsLength(source: SearchSource): number {
  return source.text?.trim().length ?? source.highlights?.join(" ").trim().length ?? 0;
}

export function reciprocalRankFusion(sets: readonly SearchResultSet[], k = RRF_K): SearchSource[] {
  const merged = new Map<
    string,
    { source: SearchSource; score: number; providers: Set<SearchProviderId> }
  >();
  for (const set of sets) {
    set.results.forEach((source, position) => {
      const url = normalizeOsintUrl(source.url);
      if (!url) return;
      const rank = Math.max(1, source.providerRank || source.index || position + 1);
      const existing = merged.get(url);
      if (!existing) {
        merged.set(url, {
          source: { ...source, provider: set.provider, providers: [set.provider] },
          score: 1 / (k + rank),
          providers: new Set([set.provider]),
        });
        return;
      }
      existing.score += 1 / (k + rank);
      existing.providers.add(set.provider);
      if (contentsLength(source) > contentsLength(existing.source)) {
        existing.source = { ...source, provider: set.provider };
      }
    });
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score)
    .map(({ source, score, providers }, index) => ({
      ...source,
      index: index + 1,
      rrfScore: score,
      providers: [...providers],
    }));
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function lexicalRelevance(query: string, text: string): number {
  const terms = (value: string) =>
    new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    );
  const queryTerms = terms(query);
  const textTerms = terms(text);
  if (!queryTerms.size || !textTerms.size) return 0;
  let matched = 0;
  for (const term of queryTerms) if (textTerms.has(term)) matched++;
  return matched / queryTerms.size;
}

export function assignSemanticRelevance(
  query: string,
  candidates: readonly RankedCandidate[],
): RankedCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    semanticRelevance: candidate.vector
      ? cosineSimilarity(candidate.queryVector ?? [], candidate.vector)
      : lexicalRelevance(
          candidate.relevanceQuery ?? query,
          `${candidate.title} ${candidate.text.slice(0, 600)}`,
        ),
  }));
}

export function hasLanguageSourceCoverage(
  sources: readonly SearchSource[],
  language: OsintLanguage,
  minimum = 2,
): boolean {
  return (
    sources.filter((source) =>
      matchesOsintLanguageScript(
        source.title + "\n" + (source.snippet ?? source.highlights?.join(" ") ?? ""),
        language,
      ),
    ).length >= minimum
  );
}

export function selectWithMmr(
  candidates: readonly RankedCandidate[],
  options: {
    lambda?: number;
    threshold?: number;
    maxPerDomain?: number;
    maxSelected?: number;
  } = {},
): RankedCandidate[] {
  const lambda = options.lambda ?? 0.7;
  const threshold = options.threshold ?? 0.18;
  const maxPerDomain = options.maxPerDomain ?? 5;
  const maxSelected = options.maxSelected ?? 21;
  const remaining = candidates.filter((candidate) => candidate.semanticRelevance >= threshold);
  const selected: RankedCandidate[] = [];
  const domainCounts = new Map<string, number>();
  const pickedUrls = new Set<string>();
  const eligibleByLanguage = new Map<OsintLanguage, RankedCandidate[]>();
  for (const candidate of remaining) {
    eligibleByLanguage.set(candidate.language, [
      ...(eligibleByLanguage.get(candidate.language) ?? []),
      candidate,
    ]);
  }
  const choose = (pool: RankedCandidate[]) => {
    let best: RankedCandidate | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of pool) {
      if ((domainCounts.get(candidate.domain) ?? 0) >= maxPerDomain) continue;
      const url = normalizeOsintUrl(candidate.url);
      if (!url || pickedUrls.has(url)) continue;
      const redundancy = selected.reduce(
        (maximum, previous) =>
          Math.max(maximum, cosineSimilarity(candidate.vector ?? [], previous.vector ?? [])),
        0,
      );
      const score = lambda * candidate.semanticRelevance - (1 - lambda) * redundancy;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  };
  const add = (candidate: RankedCandidate) => {
    const url = normalizeOsintUrl(candidate.url);
    if (!url || pickedUrls.has(url) || selected.length >= maxSelected) return false;
    selected.push(candidate);
    pickedUrls.add(url);
    domainCounts.set(candidate.domain, (domainCounts.get(candidate.domain) ?? 0) + 1);
    const index = remaining.indexOf(candidate);
    if (index >= 0) remaining.splice(index, 1);
    return true;
  };

  // Reserve room for qualified language coverage before filling globally by MMR.
  for (const pool of eligibleByLanguage.values()) {
    const target = Math.min(2, pool.length);
    for (let count = 0; count < target && selected.length < maxSelected; count++) {
      const best = choose(pool);
      if (!best || !add(best)) break;
      pool.splice(pool.indexOf(best), 1);
    }
  }
  while (remaining.length && selected.length < maxSelected) {
    const best = choose(remaining);
    if (!best || !add(best)) break;
  }
  return selected;
}

export function dedupeSearchSources<T extends SearchSource & { domain?: string }>(
  sources: readonly T[],
): T[] {
  const urls = new Set<string>();
  const titles: string[] = [];
  const output: T[] = [];
  for (const source of sources) {
    const url = normalizeOsintUrl(source.url);
    if (!url || urls.has(url)) continue;
    if (titles.some((title) => similarOsintTitle(title, source.title))) continue;
    urls.add(url);
    titles.push(source.title);
    output.push(source);
  }
  return output;
}
