import { createHash } from "node:crypto";
import { z } from "zod";

import type { OsintLanguage } from "@/lib/osint";

export const queryExpansionSchema = z
  .object({
    main: z.string().trim().min(2).max(500),
    variants: z.array(z.string().trim().min(2).max(500)).max(2),
  })
  .strict();

export type QueryExpansion = z.infer<typeof queryExpansionSchema>;

const CACHE_TTL_MS = 72 * 60 * 60_000;
const cache = new Map<string, { value: QueryExpansion; expiresAt: number }>();

function cacheKey(query: string, language: OsintLanguage): string {
  return createHash("sha256")
    .update(
      JSON.stringify({ version: 1, query: query.normalize("NFKC").trim().toLowerCase(), language }),
    )
    .digest("hex");
}

export function parseQueryExpansion(value: string, fallbackMain: string): QueryExpansion {
  try {
    const parsed: unknown = JSON.parse(value.trim());
    const result = queryExpansionSchema.safeParse(parsed);
    if (!result.success) {
      const main =
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as Record<string, unknown>)["main"] === "string"
          ? ((parsed as Record<string, unknown>)["main"] as string).trim()
          : fallbackMain;
      return { main: main.length >= 2 ? main.slice(0, 500) : fallbackMain, variants: [] };
    }
    const main = result.data.main;
    const normalizedMain = main.normalize("NFKC").toLocaleLowerCase();
    const variants = [...new Set(result.data.variants.map((variant) => variant.trim()))]
      .filter((variant) => variant.normalize("NFKC").toLocaleLowerCase() !== normalizedMain)
      .slice(0, 2);
    return { main, variants };
  } catch {
    return { main: fallbackMain, variants: [] };
  }
}

export async function cachedQueryExpansion(
  query: string,
  language: OsintLanguage,
  fallbackMain: string,
  generate: () => Promise<string>,
): Promise<QueryExpansion> {
  const key = cacheKey(query, language);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = parseQueryExpansion(await generate(), fallbackMain);
  if (cache.size >= 500) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function clearQueryExpansionCache(): void {
  cache.clear();
}
