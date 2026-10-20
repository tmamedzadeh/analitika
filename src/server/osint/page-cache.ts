import { and, eq, gt } from "drizzle-orm";

import { getDb } from "../db";
import { osintPageCache } from "../db/schema";
import type { PublicPage } from "./fetch-public-page";
import { fetchPublicPage } from "./fetch-public-page";
import { normalizeOsintUrl } from "./urls";

export const OSINT_PAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

export async function readCachedPublicPageText(url: string): Promise<string | null> {
  const normalizedUrl = normalizeOsintUrl(url);
  if (!normalizedUrl) return null;
  try {
    const [cached] = await getDb()
      .select({ text: osintPageCache.text })
      .from(osintPageCache)
      .where(
        and(
          eq(osintPageCache.normalizedUrl, normalizedUrl),
          gt(osintPageCache.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return cached?.text ?? null;
  } catch {
    return null;
  }
}

export async function cachePublicPageText(input: {
  url: string;
  language: string;
  text: string;
  title?: string | null;
  publishedAt?: Date | null;
}): Promise<void> {
  const normalizedUrl = normalizeOsintUrl(input.url);
  if (!normalizedUrl || input.text.trim().length < 800) return;
  try {
    await getDb()
      .insert(osintPageCache)
      .values({
        normalizedUrl,
        text: input.text,
        title: input.title ?? null,
        publishedAt: input.publishedAt ?? null,
        language: input.language,
        status: "fetched_full",
        expiresAt: new Date(Date.now() + OSINT_PAGE_CACHE_TTL_MS),
      })
      .onConflictDoUpdate({
        target: osintPageCache.normalizedUrl,
        set: {
          text: input.text,
          title: input.title ?? null,
          publishedAt: input.publishedAt ?? null,
          language: input.language,
          status: "fetched_full",
          expiresAt: new Date(Date.now() + OSINT_PAGE_CACHE_TTL_MS),
        },
      });
  } catch {
    // The search result remains usable when this optional cache write fails.
  }
}

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
