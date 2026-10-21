export type RankedItem = { id: string };

export async function resolveQueryEmbedding(input: {
  provided?: readonly number[];
  dimensions: number;
  embed: () => Promise<number[]>;
}): Promise<{ embedding?: number[]; failure?: "provider_error" | "invalid_vector" }> {
  let embedding: readonly number[] | undefined = input.provided;
  let failure: "provider_error" | "invalid_vector" | undefined;
  if (!embedding) {
    try {
      embedding = await input.embed();
    } catch {
      failure = "provider_error";
    }
  }
  if (
    embedding &&
    (embedding.length !== input.dimensions ||
      embedding.some((value) => !Number.isFinite(value)) ||
      embedding.every((value) => value === 0))
  ) {
    return { failure: "invalid_vector" };
  }
  return embedding ? { embedding: [...embedding] } : { ...(failure ? { failure } : {}) };
}

export type FusedResult<T> = {
  item: T;
  score: number;
};

export async function settleRetrievalBranches<T>(
  branches: readonly { name: string; run: () => Promise<T> }[],
): Promise<{ results: T[]; failed: string[] }> {
  const settled = await Promise.allSettled(branches.map(({ run }) => run()));
  const results: T[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") results.push(result.value);
    else failed.push(branches[index]?.name ?? "unknown");
  });
  if (!results.length) throw new Error("All analytics retrieval branches failed.");
  return { results, failed };
}

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
