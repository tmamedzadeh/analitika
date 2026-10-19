import { ExaRequestError } from "./exa";
import type { SearchProvider, SearchProviderId, SearchSource } from "./types";

export function searchFallbackReason(
  error: unknown,
  provider: SearchProviderId = "exa",
): string | undefined {
  if (provider !== "exa") return undefined;
  if (error instanceof ExaRequestError) {
    if (error.statusCode === 402) return "402";
    if (error.statusCode === 429) return "429";
    if (error.statusCode >= 500) return String(error.statusCode);
    return undefined;
  }
  if (error instanceof Error && /timeout|abort/i.test(error.name + " " + error.message))
    return "timeout";
  if (error instanceof Error && /fetch|network|socket|connect/i.test(error.message))
    return "network";
  return undefined;
}

export async function searchWithFallback(
  primary: SearchProvider,
  fallback: SearchProvider | undefined,
  execute: (provider: SearchProvider) => Promise<SearchSource[]>,
  onFallback?: (reason: string) => void,
): Promise<{ provider: SearchProviderId; results: SearchSource[]; fallbackReason?: string }> {
  try {
    return { provider: primary.provider, results: await execute(primary) };
  } catch (error) {
    const reason = fallback ? searchFallbackReason(error, primary.provider) : undefined;
    if (!reason || !fallback) throw error;
    onFallback?.(reason);
    const results = await execute(fallback);
    return { provider: fallback.provider, results, fallbackReason: reason };
  }
}
