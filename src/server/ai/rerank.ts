import { z } from "zod";

import { GeminiLLMProvider } from "./gemini";
import type { ProviderRequestOptions } from "./types";

export const RERANK_TIMEOUT_MS = 4_000;
export const RERANK_INPUT_LIMIT = 30;
export const RERANK_EXCERPT_LIMIT = 500;

export type RerankCandidate = {
  id: string;
  excerpt: string;
};

export interface RerankProvider {
  rerank(
    query: string,
    candidates: readonly RerankCandidate[],
    options?: ProviderRequestOptions & { timeoutMs?: number },
  ): Promise<readonly string[]>;
}

function completeOrder(ids: readonly string[], expectedIds: readonly string[]): string[] {
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (expected.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

export function parseRerankResponse(response: string, expectedIds: readonly string[]): string[] {
  const trimmed = response
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return [...expectedIds];
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [...expectedIds];
    const values = (parsed as Record<string, unknown>)["ids"];
    if (!Array.isArray(values)) return [...expectedIds];
    const ids = values.filter((value): value is string => typeof value === "string");
    return completeOrder(ids, expectedIds);
  } catch {
    return [...expectedIds];
  }
}

export async function rerankOrderOrOriginal(
  query: string,
  candidates: readonly RerankCandidate[],
  provider: RerankProvider | undefined,
  enabled: boolean,
  timeoutMs = RERANK_TIMEOUT_MS,
  signal?: AbortSignal,
  beforeRequest?: () => Promise<void>,
): Promise<string[]> {
  const expectedIds = candidates.slice(0, RERANK_INPUT_LIMIT).map(({ id }) => id);
  if (!enabled || !provider || expectedIds.length === 0) return expectedIds;

  const input = candidates.slice(0, RERANK_INPUT_LIMIT).map(({ id, excerpt }) => ({
    id,
    excerpt: excerpt.slice(0, RERANK_EXCERPT_LIMIT),
  }));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    const proposed = await Promise.race([
      provider.rerank(query, input, {
        timeoutMs,
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        ...(beforeRequest ? { beforeRequest } : {}),
      }),
      timeout,
    ]);
    return proposed ? completeOrder(proposed, expectedIds) : expectedIds;
  } catch {
    return expectedIds;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const rerankOutputSchema = z.object({ ids: z.array(z.string()).max(RERANK_INPUT_LIMIT) });

export class GeminiRerankProvider implements RerankProvider {
  constructor(private readonly model: GeminiLLMProvider) {}

  async rerank(
    query: string,
    candidates: readonly RerankCandidate[],
    options: ProviderRequestOptions & { timeoutMs?: number } = {},
  ): Promise<readonly string[]> {
    const input = candidates.slice(0, RERANK_INPUT_LIMIT).map(({ id, excerpt }) => ({
      id,
      excerpt: excerpt.slice(0, RERANK_EXCERPT_LIMIT),
    }));
    const result = await this.model.generateObject(
      {
        system:
          "Rank candidate excerpts by how directly they answer the supplied Azerbaijani information retrieval question. Return only the requested JSON object with candidate IDs in descending relevance order. Do not invent IDs.",
        prompt: JSON.stringify({ query, candidates: input }),
        temperature: 0,
        timeoutMs: options.timeoutMs ?? RERANK_TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.beforeRequest ? { beforeRequest: options.beforeRequest } : {}),
        maxAttempts: 1,
      },
      rerankOutputSchema,
    );
    return completeOrder(
      result.ids,
      input.map(({ id }) => id),
    );
  }
}
