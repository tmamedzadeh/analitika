export type RankedItem = { id: string };

export type FusedResult<T> = {
  item: T;
  score: number;
};

export function reciprocalRankFusion<T extends RankedItem>(
  rankedLists: readonly (readonly T[])[],
  k = 60,
): FusedResult<T>[] {
  const fused = new Map<string, FusedResult<T>>();

  for (const list of rankedLists) {
    const seenInList = new Set<string>();
    for (const [index, item] of list.entries()) {
      if (seenInList.has(item.id)) continue;
      seenInList.add(item.id);

      const result = fused.get(item.id);
      if (result) {
        result.score += 1 / (k + index + 1);
      } else {
        fused.set(item.id, { item, score: 1 / (k + index + 1) });
      }
    }
  }

  return [...fused.values()].sort((left, right) => right.score - left.score);
}
