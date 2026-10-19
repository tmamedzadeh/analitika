import { and, eq, gt } from "drizzle-orm";

import { getDb } from "../db";
import { osintPageCache } from "../db/schema";
import type { PublicPage } from "./fetch-public-page";
import { fetchPublicPage } from "./fetch-public-page";
import { normalizeOsintUrl } from "./urls";

export const OSINT_PAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

export async function fetchCachedPublicPage(
  url: string,
  language: string,
  timeoutMs = 8_000,
): Promise<PublicPage> {
  const normalizedUrl = normalizeOsintUrl(url);
  if (normalizedUrl) {
    try {
      const [cached] = await getDb()
        .select()
        .from(osintPageCache)
        .where(
          and(
            eq(osintPageCache.normalizedUrl, normalizedUrl),
            gt(osintPageCache.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (cached) {
        return {
          fetched: cached.status === "fetched_full",
          text: cached.text,
          fetchStatus: cached.status as PublicPage["fetchStatus"],
          ...(cached.title ? { title: cached.title } : {}),
          ...(cached.publishedAt ? { publishedAt: cached.publishedAt } : {}),
        };
      }
    } catch {
      // Continue to the established secure fetch path if the optional cache is unavailable.
    }
  }

  const page = await fetchPublicPage(url, timeoutMs);
  if (normalizedUrl && page.fetched && page.text.trim().length >= 800) {
    try {
      await getDb()
        .insert(osintPageCache)
        .values({
          normalizedUrl,
          text: page.text,
          title: page.title ?? null,
          publishedAt: page.publishedAt ?? null,
          language,
          status: page.fetchStatus,
          expiresAt: new Date(Date.now() + OSINT_PAGE_CACHE_TTL_MS),
        })
        .onConflictDoUpdate({
          target: osintPageCache.normalizedUrl,
          set: {
            text: page.text,
            title: page.title ?? null,
            publishedAt: page.publishedAt ?? null,
            language,
            status: page.fetchStatus,
            expiresAt: new Date(Date.now() + OSINT_PAGE_CACHE_TTL_MS),
          },
        });
    } catch {
      // Cache writes are best effort; page retrieval already succeeded.
    }
  }
  return page;
}
