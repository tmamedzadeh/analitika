export type RetrievalMetrics = { recall5: number; recall10: number; mrr: number; ndcg: number };

/** Source recall over the first k returned chunk slots; repeated sources earn credit once. */
export function retrievalMetrics(
  results: readonly { documentId: string | null; briefId: string | null }[],
  expected: ReadonlySet<string>,
): RetrievalMetrics {
  const ranked = results.map((source) =>
    source.documentId ? `document:${source.documentId}` : `brief:${source.briefId}`,
  );
  const seen = new Set<string>();
  const relevance = ranked.slice(0, 10).map((id) => {
    const relevant = expected.has(id) && !seen.has(id);
    seen.add(id);
    return Number(relevant);
  });
  const recall = (k: number) =>
    expected.size
      ? new Set(ranked.slice(0, k).filter((id) => expected.has(id))).size / expected.size
      : 0;
  const dcg = relevance.reduce((sum, relevant, rank) => sum + relevant / Math.log2(rank + 2), 0);
  const ideal = Array.from(
    { length: Math.min(expected.size, 10) },
    (_, rank) => 1 / Math.log2(rank + 2),
  ).reduce((sum, value) => sum + value, 0);
  const first = relevance.indexOf(1);
  return {
    recall5: recall(5),
    recall10: recall(10),
    mrr: first < 0 ? 0 : 1 / (first + 1),
    ndcg: ideal ? dcg / ideal : 0,
  };
}
