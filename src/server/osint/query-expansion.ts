import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import type { OsintLanguage } from "@/lib/osint";
import { getDb } from "@/server/db";
import { osintQueryCache } from "@/server/db/schema";

export const queryExpansionSchema = z
  .object({
    main: z.string().trim().min(2).max(500),
    variants: z.array(z.string().trim().min(2).max(500)).max(2),
  })
  .strict();

export type QueryExpansion = z.infer<typeof queryExpansionSchema>;

const CACHE_TTL_MS = 72 * 60 * 60_000;

export function queryExpansionsSchema(languages: readonly OsintLanguage[]) {
  const shape = Object.fromEntries(
    languages.map((language) => [language, queryExpansionSchema]),
  ) as Record<OsintLanguage, typeof queryExpansionSchema>;
  return z.object(shape).strict();
}

function cacheKey(query: string, languages: readonly OsintLanguage[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 3,
        query: query.normalize("NFKC").trim().toLowerCase(),
        languages: [...languages].sort(),
      }),
    )
    .digest("hex");
}

function normalizeExpansion(value: unknown, fallbackMain: string): QueryExpansion {
  const result = queryExpansionSchema.safeParse(value);
  if (!result.success) return { main: fallbackMain, variants: [] };
  const main = result.data.main;
  const normalizedMain = main.normalize("NFKC").toLocaleLowerCase();
  const variants = [...new Set(result.data.variants.map((variant) => variant.trim()))]
    .filter((variant) => variant.normalize("NFKC").toLocaleLowerCase() !== normalizedMain)
    .slice(0, 2);
  return { main, variants };
}

export async function cachedQueryExpansions(
  query: string,
  languages: readonly OsintLanguage[],
  generate: () => Promise<unknown>,
): Promise<Record<OsintLanguage, QueryExpansion>> {
  const key = cacheKey(query, languages);
  try {
    const [cached] = await getDb()
      .select({ result: osintQueryCache.result })
      .from(osintQueryCache)
      .where(and(eq(osintQueryCache.cacheKey, key), gt(osintQueryCache.expiresAt, new Date())))
      .limit(1);
    if (cached) {
      const parsed = queryExpansionsSchema(languages).safeParse(cached.result);
      if (parsed.success) {
        return normalizeQueryExpansions(parsed.data, query, languages);
      }
    }
  } catch {
    // A cache read failure does not prevent the search from proceeding.
  }

  const generated = await generate();
  const parsed = queryExpansionsSchema(languages).safeParse(generated);
  if (!parsed.success) throw new Error("Invalid query expansion object.");
  const output = normalizeQueryExpansions(parsed.data, query, languages);
  try {
    await getDb()
      .insert(osintQueryCache)
      .values({ cacheKey: key, result: output, expiresAt: new Date(Date.now() + CACHE_TTL_MS) })
      .onConflictDoUpdate({
        target: osintQueryCache.cacheKey,
        set: { result: output, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
      });
  } catch {
    // Persisted expansion caching is an optimization; a failed write is harmless.
  }
  return output;
}

export function normalizeQueryExpansions(
  value: unknown,
  originalQuery: string,
  languages: readonly OsintLanguage[],
): Record<OsintLanguage, QueryExpansion> {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const output = {} as Record<OsintLanguage, QueryExpansion>;
  for (const language of languages) {
    const normalized = normalizeExpansion(source[language], originalQuery);
    output[language] =
      language === "az" ? { main: originalQuery, variants: normalized.variants } : normalized;
  }
  return output;
}
