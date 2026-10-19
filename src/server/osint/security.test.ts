import { describe, expect, it } from "vitest";

import { isPublicIpAddress, resolvePublicHost } from "./ssrf";
import {
  createOsintCacheKey,
  isWithinOsintPeriod,
  matchesOsintLanguageScript,
  normalizeOsintUrl,
  similarOsintTitle,
} from "./urls";

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
});
