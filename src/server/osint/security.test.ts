import { describe, expect, it } from "vitest";

import { isPublicIpAddress, resolvePublicHost } from "./ssrf";
import {
  createOsintCacheKey,
  createOsintSearchCacheKey,
  isWithinOsintPeriod,
  matchesOsintLanguageScript,
  normalizeOsintTitle,
  normalizeOsintUrl,
  similarOsintTitle,
} from "./urls";
import { OSINT_LANGUAGES, osintLanguageLocale, osintLanguageNames } from "@/lib/osint";
import { OSINT_PAGE_CACHE_TTL_MS } from "./page-cache";
import { osintSearchCacheTtl } from "./search-cache";

describe("OSINT URL and request guards", () => {
  it("normalizes public HTTP URLs and removes tracking parameters", () => {
    expect(
      normalizeOsintUrl("https://www.example.com/report/?utm_source=search&id=3#section"),
    ).toBe("https://example.com/report?id=3");
  });

  it("rejects non-web protocols, credentials, and unusual ports", () => {
    expect(normalizeOsintUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeOsintUrl("https://user:pass@example.com/article")).toBeNull();
    expect(normalizeOsintUrl("http://example.com:8080/article")).toBeNull();
  });

  it("blocks local, private, and link-local addresses, including mapped IPv4", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.8")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
  });

  it("does not resolve localhost or other private host names", async () => {
    await expect(resolvePublicHost("localhost")).rejects.toThrow("Private host blocked");
    await expect(resolvePublicHost("127.0.0.1")).rejects.toThrow("Private address blocked");
  });

  it("uses stable cache keys, deduplicates similar titles, and enforces requested periods", () => {
    expect(createOsintCacheKey("  Query   text ", ["en", "ru"], "7d")).toBe(
      createOsintCacheKey("query text", ["ru", "en"], "7d"),
    );
    expect(createOsintCacheKey("query text", ["en"], "7d")).not.toBe(
      createOsintCacheKey("query text", ["en"], "30d"),
    );
    expect(similarOsintTitle("Report on regional security", "Regional security report")).toBe(true);
    const now = new Date("2026-10-19T12:00:00.000Z");
    expect(isWithinOsintPeriod(null, "24h", now)).toBe(false);
    expect(isWithinOsintPeriod(null, "all", now)).toBe(true);
    expect(isWithinOsintPeriod(new Date("2026-10-19T11:00:00.000Z"), "24h", now)).toBe(true);
    expect(isWithinOsintPeriod(new Date("2026-10-19T12:01:00.000Z"), "24h", now)).toBe(false);
  });

  it("rejects OSINT results whose text uses another language's writing system", () => {
    expect(matchesOsintLanguageScript("آمادگی رزمی نیروهای مسلح در تمرین جدید", "fa")).toBe(true);
    expect(
      matchesOsintLanguageScript("Հայաստանի զինված ուժերի մարտական պատրաստություն", "hy"),
    ).toBe(true);
    expect(
      matchesOsintLanguageScript("Комплексная проверка боевой и мобилизационной готовности", "fa"),
    ).toBe(false);
    expect(
      matchesOsintLanguageScript("Комплексная проверка боевой и мобилизационной готовности", "hy"),
    ).toBe(false);
  });

  it("keeps cached runs separate across provider and model settings", () => {
    expect(createOsintCacheKey("query text", ["en"], "all", "exa:gemini-model")).not.toBe(
      createOsintCacheKey("query text", ["en"], "all", "gemini_grounding:gemini-model"),
    );
  });

  it("defines all seven language labels and locale mappings", () => {
    expect(OSINT_LANGUAGES).toEqual(["fa", "hy", "ru", "zh", "en", "fr", "ka"]);
    expect(Object.keys(osintLanguageNames)).toHaveLength(7);
    expect(osintLanguageLocale).toMatchObject({
      fa: { language: "FA", country: "IR" },
      hy: { language: "AM", country: "AM" },
      ru: { language: "RU", country: "RU" },
      zh: { language: "CN", country: "CN" },
      en: { language: "US", country: "US" },
      fr: { language: "FR", country: "FR" },
      ka: { language: "GE", country: "GE" },
    });
    expect(matchesOsintLanguageScript("ქართული ენა ტექსტი და ცნობები საქართველოში", "ka")).toBe(
      true,
    );
  });

  it("keys provider search cache by provider, language, query, period, and domain filters", () => {
    const base = {
      provider: "exa",
      language: "en",
      query: "regional talks",
      period: "7d" as const,
    };
    const key = createOsintSearchCacheKey(base);
    expect(createOsintSearchCacheKey({ ...base, query: " Regional   Talks " })).toBe(key);
    expect(createOsintSearchCacheKey({ ...base, provider: "tavily" })).not.toBe(key);
    expect(createOsintSearchCacheKey({ ...base, language: "fr" })).not.toBe(key);
    expect(createOsintSearchCacheKey({ ...base, period: "30d" })).not.toBe(key);
    expect(createOsintSearchCacheKey({ ...base, includeDomains: ["b.org", "a.org"] })).not.toBe(
      key,
    );
    expect(createOsintSearchCacheKey({ ...base, includeDomains: ["B.org", "a.org"] })).toBe(
      createOsintSearchCacheKey({ ...base, includeDomains: ["a.org", "b.org"] }),
    );
  });

  it("uses the requested search-cache and page-cache TTLs", () => {
    expect(osintSearchCacheTtl("24h")).toBe(3 * 60 * 60_000);
    expect(osintSearchCacheTtl("7d")).toBe(12 * 60 * 60_000);
    expect(osintSearchCacheTtl("30d")).toBe(72 * 60 * 60_000);
    expect(osintSearchCacheTtl("all")).toBe(72 * 60 * 60_000);
    expect(OSINT_PAGE_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60_000);
  });

  it("centralizes title normalization for obvious publication duplicates", () => {
    expect(normalizeOsintTitle("  Regional SECURITY—Report ")).toBe("regional security report");
  });
});
