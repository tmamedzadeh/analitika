import { describe, expect, it } from "vitest";

import {
  chooseSourceText,
  hasProviderPageText,
  osintFailureCategory,
  parseBatchSummary,
  parseTranslatedQueries,
} from "./run-osint";
import { GeminiQuotaExceededError } from "../ai/gemini-gateway";
import { shouldReadOsintSearchCache, shouldServePinnedCache } from "../osint/cache";
import { ExaRequestError } from "../ai/exa";
import { searchFallbackReason } from "../ai/provider-fallback";

describe("OSINT pipeline helpers", () => {
  it("rejects broken batch-summary JSON so the job can keep source snippets", () => {
    expect(() => parseBatchSummary("{not valid JSON", [1, 2])).toThrow("Invalid JSON");
  });

  it("parses a batch-summary array containing JSON objects", () => {
    expect(parseBatchSummary('[{"number":1,"summary":"Mənbədə nəticə var."}]', [1, 2])).toEqual([
      { number: 1, summary: "Mənbədə nəticə var." },
    ]);
  });

  it("uses Exa page text first, fetched page second, and a snippet as fallback", () => {
    const providerText = "Provider article ".repeat(60);
    const fetchedText = "Fetched page ".repeat(70);
    expect(chooseSourceText(providerText, fetchedText, "Search snippet")).toEqual({
      text: providerText.trim(),
      status: "provider_text",
    });
    expect(chooseSourceText(undefined, fetchedText, "Search snippet")).toEqual({
      text: fetchedText.trim(),
      status: "fetched_full",
    });
    expect(chooseSourceText(undefined, undefined, "Search snippet")).toEqual({
      text: "Search snippet",
      status: "snippet_fallback",
    });
  });

  it("recognizes provider text only when it reaches the full-text threshold", () => {
    expect(
      hasProviderPageText({
        url: "https://example.org",
        title: "Example",
        index: 1,
        text: "Full article ".repeat(80),
      }),
    ).toBe(true);
    expect(
      hasProviderPageText({
        url: "https://example.org",
        title: "Example",
        index: 1,
        text: "Short snippet",
      }),
    ).toBe(false);
  });

  it("serves pinned completed runs without external calls unless refresh is requested", () => {
    expect(shouldServePinnedCache({ pinned: true, done: true, refresh: false })).toBe(true);
    expect(shouldServePinnedCache({ pinned: true, done: true, refresh: true })).toBe(false);
    expect(shouldServePinnedCache({ pinned: true, done: false, refresh: false })).toBe(false);
    expect(shouldReadOsintSearchCache(false)).toBe(true);
    expect(shouldReadOsintSearchCache(true)).toBe(false);
  });

  it("requires a translation for every requested language", () => {
    expect(parseTranslatedQueries('{"ru":"переговоры"}', ["ru"])).toEqual({ ru: "переговоры" });
    expect(() => parseTranslatedQueries("{}", ["ru"])).toThrow("Translation missing");
  });

  it("classifies quota and JSON failures without including provider text", () => {
    expect(
      osintFailureCategory(new GeminiQuotaExceededError("GEMINI_LIGHT_MODEL", "per-minute")),
    ).toBe("gemini_quota_per-minute");
    expect(osintFailureCategory(new SyntaxError("invalid response body"))).toBe("invalid_json");
  });

  it("uses Tavily fallback only for Exa technical failures", () => {
    expect(searchFallbackReason(new Error("Page request timeout"))).toBe("timeout");
    expect(searchFallbackReason(new TypeError("fetch failed"))).toBe("network");
    expect(searchFallbackReason(new ExaRequestError(402))).toBe("402");
    expect(searchFallbackReason(new ExaRequestError(429))).toBe("429");
    expect(searchFallbackReason(new ExaRequestError(503))).toBe("503");
    expect(searchFallbackReason(new ExaRequestError(401))).toBeUndefined();
  });
});
