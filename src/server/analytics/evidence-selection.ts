import { analyticsSourceGroupKey, type AnalyticsSource } from "@/lib/analytics";
import { formatAnalyticsEvidence, normalizedEvidenceText } from "../prompts/analytics-evidence";
import { normalizeSearchText, rankLexicalMatches } from "../search/lexical";
import {
  EVIDENCE_CHUNK_LIMIT,
  EVIDENCE_CONTEXT_BYTE_LIMIT,
  EVIDENCE_CONTEXT_CHAR_LIMIT,
} from "./evidence-limits";

export function fitsEvidenceContext(
  sources: readonly AnalyticsSource[],
  additionalPayload = "",
): boolean {
  const payload = "Mənbə fraqmentləri:\n" + formatAnalyticsEvidence(sources) + additionalPayload;
  return (
    payload.length <= EVIDENCE_CONTEXT_CHAR_LIMIT &&
    Buffer.byteLength(payload, "utf8") <= EVIDENCE_CONTEXT_BYTE_LIMIT
  );
}

export class EvidenceContextBudgetError extends Error {
  constructor() {
    super("Retrieved evidence exceeds the context budget.");
    this.name = "EvidenceContextBudgetError";
  }
}

function shingles(text: string): Set<string> {
  // Keep case, punctuation and quantities: a changed fact must not be collapsed.
  const words = normalizedEvidenceText(text).split(" ");
  if (words.length < 5) return new Set([words.join(" ")]);
  return new Set(words.slice(4).map((_, index) => words.slice(index, index + 5).join(" ")));
}
function salientTokens(text: string): Set<string> {
  // Novel numbers, names/acronyms and negations bypass the redundancy gate.
  const tokens = text.match(/\p{N}[\p{L}\p{N}.,:/%+-]*|\p{Lu}[\p{L}\p{N}-]*/gu) ?? [];
  const negations =
    normalizeSearchText(text).match(
      /(?<!\p{L})(?:not|no|never|without|нет|не|без|deyil|yox|olmadan)(?!\p{L})/gu,
    ) ?? [];
  return new Set([...tokens, ...negations]);
}

/**
 * Input must already be authorized and ordered by RRF/optional rerank.
 * Preserve that order; never exchange a stronger fragment for a new parent.
 * Novelty thresholds are redundancy heuristics, not relevance probabilities.
 */
export function selectAnalyticsEvidence(
  query: string,
  ranked: readonly AnalyticsSource[],
  semanticChunkIds: ReadonlySet<string> = new Set(),
): AnalyticsSource[] {
  const selected: AnalyticsSource[] = [];
  const ids = new Set<string>();
  const textsByParent = new Map<string, Set<string>>();
  const parents = new Map<string, { count: number; shingles: Set<string>; salient: Set<string> }>();
  let hasQuerySupport = false;
  let budgetRejected = false;
  for (const source of ranked) {
    if (selected.length === EVIDENCE_CHUNK_LIMIT) break;
    const text = normalizedEvidenceText(source.text);
    if (!text || ids.has(source.chunkId)) continue;
    const key = analyticsSourceGroupKey(source);
    // Identical text in a different parent keeps its own UUID, ACL and history
    // mapping. The formatter transmits the body once and labels the overlap.
    if (textsByParent.get(key)?.has(text)) continue;
    const parent = parents.get(key);
    const lexicalSupport =
      rankLexicalMatches(
        query,
        { title: source.title, body: source.sectionTitle + "\n" + source.text },
        "any",
      ) > 0;
    // Do not invent a semantic score: vector-branch membership is an actual
    // retrieval signal. Same-parent detail can rely on its earlier anchor.
    if (
      selected.length &&
      hasQuerySupport &&
      !lexicalSupport &&
      !semanticChunkIds.has(source.chunkId) &&
      !parent
    )
      continue;
    const content = shingles(source.text);
    const salient = salientTokens(source.text);
    if (parent) {
      const novel = [...content].filter((value) => !parent.shingles.has(value)).length;
      const hasNewFactToken = [...salient].some((value) => !parent.salient.has(value));
      // First two: reject near copies (<=10% new five-word sequences).
      // Third onward: require >25% new sequences, or a changed salient fact.
      const minimumNovelty = parent.count < 2 ? 0.1 : 0.25;
      if (!hasNewFactToken && novel / content.size <= minimumNovelty) continue;
    }
    const candidate = { ...source, n: selected.length + 1 };
    // Reformat the entire prospective set: adding a same-parent citation also
    // grows metadata on previously selected chunks. Never truncate a chunk.
    if (!fitsEvidenceContext([...selected, candidate])) {
      budgetRejected = true;
      continue;
    }
    selected.push(candidate);
    ids.add(source.chunkId);
    const parentTexts = textsByParent.get(key) ?? new Set<string>();
    parentTexts.add(text);
    textsByParent.set(key, parentTexts);
    hasQuerySupport ||= lexicalSupport;
    const next = parent ?? { count: 0, shingles: new Set<string>(), salient: new Set<string>() };
    next.count++;
    for (const value of content) next.shingles.add(value);
    for (const value of salient) next.salient.add(value);
    parents.set(key, next);
  }
  if (!selected.length && budgetRejected) throw new EvidenceContextBudgetError();
  return selected;
}
