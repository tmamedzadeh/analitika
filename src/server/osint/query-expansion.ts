import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import type { OsintLanguage } from "@/lib/osint";
import { getDb } from "@/server/db";
import { osintQueryCache } from "@/server/db/schema";

export const QUERY_EXPANSION_HTTP_TIMEOUT_MS = 30_000;
export const QUERY_EXPANSION_PRIMARY_BUDGET_MS = 55_000;
export const QUERY_EXPANSION_FALLBACK_BUDGET_MS = 30_000;

export const queryExpansionSchema = z
  .object({
    main: z.string().trim().min(2).max(500),
    variants: z.array(z.string().trim().min(2).max(500)).max(2),
  })
  .strict();

export function queryExpansionMainSchema(languages: readonly OsintLanguage[]) {
  return z
    .object(
      Object.fromEntries(
        languages.map((language) => [language, z.string().trim().min(2).max(500)]),
      ),
    )
    .strict();
}

export type QueryExpansion = z.infer<typeof queryExpansionSchema>;
export type QueryExpansionRun = {
  expansions: Record<OsintLanguage, QueryExpansion>;
  fallbackLanguages: OsintLanguage[];
  primaryFailed: boolean;
  fallbackFailed: boolean;
  error?: unknown;
};

const CACHE_TTL_MS = 72 * 60 * 60_000;

export function queryExpansionsSchema(languages: readonly OsintLanguage[]) {
  const shape = Object.fromEntries(
    languages.map((language) => [language, queryExpansionSchema]),
  ) as Record<OsintLanguage, typeof queryExpansionSchema>;
  return z.object(shape).strict();
}

export function createQueryExpansionCacheKey(
  query: string,
  languages: readonly OsintLanguage[],
  model: string,
  promptVersion = 2,
): string {
  const normalizedQuery = query
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");
  const canonical = JSON.stringify({
    promptVersion,
    query: normalizedQuery,
    languages: [...new Set(languages)].sort(),
    model: model.trim(),
  });
  return createHash("sha256").update(canonical).digest("hex");
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
  model: string,
  generate: () => Promise<unknown>,
  hooks: { cacheable?: () => boolean; onCacheError?: () => void } = {},
): Promise<Record<OsintLanguage, QueryExpansion>> {
  const key = `osint-expansion:v2:${createQueryExpansionCacheKey(query, languages, model)}`;
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
    hooks.onCacheError?.();
  }

  const generated = await generate();
  const parsed = queryExpansionsSchema(languages).safeParse(generated);
  if (!parsed.success) throw new Error("Invalid query expansion object.");
  const output = normalizeQueryExpansions(parsed.data, query, languages);
  if (hooks.cacheable && !hooks.cacheable()) return output;
  try {
    await getDb()
      .insert(osintQueryCache)
      .values({ cacheKey: key, result: output, expiresAt: new Date(Date.now() + CACHE_TTL_MS) })
      .onConflictDoUpdate({
        target: osintQueryCache.cacheKey,
        set: { result: output, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
      });
  } catch {
    hooks.onCacheError?.();
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

export async function generateQueryExpansionsWithFallback(
  query: string,
  languages: readonly OsintLanguage[],
  generatePrimary: () => Promise<unknown>,
  generateFallback: (languages: readonly Exclude<OsintLanguage, "az">[]) => Promise<unknown>,
): Promise<QueryExpansionRun> {
  try {
    const parsed = queryExpansionsSchema(languages).parse(await generatePrimary());
    return {
      expansions: normalizeQueryExpansions(parsed, query, languages),
      fallbackLanguages: [],
      primaryFailed: false,
      fallbackFailed: false,
    };
  } catch (primaryError) {
    const fallbackLanguages = languages.filter(
      (language): language is Exclude<OsintLanguage, "az"> => language !== "az",
    );
    if (!fallbackLanguages.length) {
      return {
        expansions: normalizeQueryExpansions({}, query, languages),
        fallbackLanguages,
        primaryFailed: true,
        fallbackFailed: false,
      };
    }
    try {
      const fallback = queryExpansionMainSchema(fallbackLanguages).parse(
        await generateFallback(fallbackLanguages),
      );
      const expansions = Object.fromEntries(
        languages.map((language) => [
          language,
          language === "az"
            ? { main: query, variants: [] }
            : { main: fallback[language as Exclude<OsintLanguage, "az">], variants: [] },
        ]),
      );
      return {
        expansions: expansions as unknown as Record<OsintLanguage, QueryExpansion>,
        fallbackLanguages,
        primaryFailed: true,
        fallbackFailed: false,
      };
    } catch (fallbackError) {
      return {
        expansions: normalizeQueryExpansions({}, query, languages),
        fallbackLanguages,
        primaryFailed: true,
        fallbackFailed: true,
        error: fallbackError ?? primaryError,
      };
    }
  }
}
