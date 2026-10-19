import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import type { OsintPeriod } from "@/lib/osint";
import type { SearchProviderId, SearchSource } from "../ai/types";
import { getDb } from "../db";
import { osintSearchCache } from "../db/schema";
import { createOsintSearchCacheKey } from "./urls";

const providerIds = ["exa", "tavily", "hasdata", "gemini_grounding"] as const;
const cachedSearchSource = z.object({
  url: z.string().url(),
  title: z.string(),
  publishedDate: z.string().optional(),
  publishedAt: z.string().optional(),
  snippet: z.string().optional(),
  text: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  searchSummary: z.string().optional(),
  index: z.number().int().positive(),
  providerRank: z.number().int().positive().optional(),
  provider: z.enum(providerIds).optional(),
  providers: z.array(z.enum(providerIds)).optional(),
});

export function osintSearchCacheTtl(period: OsintPeriod): number {
  if (period === "24h") return 3 * 60 * 60_000;
  if (period === "7d") return 12 * 60 * 60_000;
  return 72 * 60 * 60_000;
}

export type SearchCacheInput = {
  provider: SearchProviderId;
  language: string;
  query: string;
  period: OsintPeriod;
  includeDomains?: string[];
};

export async function readOsintSearchCache(
  input: SearchCacheInput,
): Promise<SearchSource[] | null> {
  const cacheKey = createOsintSearchCacheKey(input);
  try {
    const [cached] = await getDb()
      .select({ results: osintSearchCache.results })
      .from(osintSearchCache)
      .where(
        and(eq(osintSearchCache.cacheKey, cacheKey), gt(osintSearchCache.expiresAt, new Date())),
      )
      .limit(1);
    if (!cached) return null;
    const parsed = z.array(cachedSearchSource).safeParse(cached.results);
    return parsed.success
      ? parsed.data.map((source): SearchSource => ({
          url: source.url,
          title: source.title,
          index: source.index,
          ...(source.publishedDate ? { publishedDate: source.publishedDate } : {}),
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          ...(source.snippet ? { snippet: source.snippet } : {}),
          ...(source.providerRank ? { providerRank: source.providerRank } : {}),
          ...(source.text ? { text: source.text } : {}),
          ...(source.highlights ? { highlights: source.highlights } : {}),
          ...(source.searchSummary ? { searchSummary: source.searchSummary } : {}),
          ...(source.provider ? { provider: source.provider } : {}),
          ...(source.providers ? { providers: source.providers } : {}),
        }))
      : null;
  } catch {
    return null;
  }
}

export async function writeOsintSearchCache(
  input: SearchCacheInput,
  results: SearchSource[],
): Promise<void> {
  if (!results.length) return;
  const cacheKey = createOsintSearchCacheKey(input);
  try {
    const expiresAt = new Date(Date.now() + osintSearchCacheTtl(input.period));
    await getDb()
      .insert(osintSearchCache)
      .values({
        cacheKey,
        provider: input.provider,
        language: input.language,
        period: input.period,
        includeDomains: input.includeDomains ?? [],
        results,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: osintSearchCache.cacheKey,
        set: { results, expiresAt },
      });
  } catch {
    // Search cache is an optimization; provider results remain available to this run.
  }
}
