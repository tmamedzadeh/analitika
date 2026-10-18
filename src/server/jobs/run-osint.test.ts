import { describe, expect, it } from "vitest";

import {
  chooseSourceText,
  hasProviderPageText,
  osintFailureCategory,
  parseBatchSummary,
  parseTranslatedQueries,
} from "./run-osint";
import { GeminiQuotaExceededError } from "../ai/gemini-gateway";
import { shouldServePinnedCache } from "../osint/cache";

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
    expect(chooseSourceText("Provider article", "Fetched page", "Search snippet")).toEqual({
      text: "Provider article",
      status: "provider_text",
    });
    expect(chooseSourceText(undefined, "Fetched page", "Search snippet")).toEqual({
      text: "Fetched page",
      status: "fetched_full",
    });
    expect(chooseSourceText(undefined, undefined, "Search snippet")).toEqual({
      text: "Search snippet",
      status: "snippet_fallback",
    });
  });

  it("recognizes non-empty page text returned by Exa", () => {
    expect(
      hasProviderPageText({
        url: "https://example.org",
        title: "Example",
        index: 1,
        text: "Full article",
      }),
    ).toBe(true);
    expect(
      hasProviderPageText({ url: "https://example.org", title: "Example", index: 1, text: "  " }),
    ).toBe(false);
  });

  it("serves pinned completed runs without external calls unless refresh is requested", () => {
    expect(shouldServePinnedCache({ pinned: true, done: true, refresh: false })).toBe(true);
    expect(shouldServePinnedCache({ pinned: true, done: true, refresh: true })).toBe(false);
    expect(shouldServePinnedCache({ pinned: true, done: false, refresh: false })).toBe(false);
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
});
