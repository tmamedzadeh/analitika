import { describe, expect, it } from "vitest";

import {
  chooseSourceText,
  compactFallbackReason,
  executeOsintSearchPhases,
  hasProviderPageText,
  inferUnregisteredSourceType,
  osintFailureCategory,
  partitionSearchRequestBudget,
  planOsintSearchPhases,
  statusFor,
} from "./run-osint";
import { GeminiQuotaExceededError } from "../ai/gemini-gateway";
import { shouldReadOsintSearchCache, shouldServePinnedCache } from "../osint/cache";
import { ExaRequestError } from "../ai/exa";
import { SearchRequestBudget } from "../ai/exa";
import { searchFallbackReason } from "../ai/provider-fallback";
import { OSINT_LANGUAGES } from "@/lib/osint";
import { generateQueryExpansionsWithFallback } from "../osint/query-expansion";

describe("OSINT pipeline helpers", () => {
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

  it("plans the main query for all eight languages, then registry and variants", async () => {
    const expansions = Object.fromEntries(
      OSINT_LANGUAGES.map((language) => [
        language,
        { main: "original query", variants: [`variant ${language}`] },
      ]),
    ) as Record<(typeof OSINT_LANGUAGES)[number], { main: string; variants: string[] }>;
    const plan = planOsintSearchPhases(OSINT_LANGUAGES, expansions, new Map());
    expect(plan.main).toHaveLength(8);
    expect(plan.registry).toHaveLength(8);
    expect(plan.variants).toHaveLength(8);
    const phases: string[] = [];
    await executeOsintSearchPhases(
      async () => {
        phases.push("main");
      },
      () => plan.registry,
      plan.variants,
      () => true,
      async (name) => {
        phases.push(name);
      },
    );
    expect(phases).toEqual(["main", "registry", "variants"]);
  });

  it("continues main search with original queries when primary and fallback expansion fail", async () => {
    const languages = ["az", "fa", "en"] as const;
    let fallbackCalls = 0;
    const expansion = await generateQueryExpansionsWithFallback(
      "original query",
      languages,
      async () => {
        throw new Error("primary expansion failed");
      },
      async (requested) => {
        fallbackCalls += 1;
        expect(requested).toEqual(["fa", "en"]);
        throw new Error("fallback expansion failed");
      },
    );
    const plan = planOsintSearchPhases(languages, expansion.expansions, new Map());
    const searched: string[] = [];

    await executeOsintSearchPhases(
      async () => {
        searched.push(...plan.main.map((task) => task.query));
      },
      () => plan.registry,
      plan.variants,
      () => false,
      async () => undefined,
    );

    expect(fallbackCalls).toBe(1);
    expect(expansion.fallbackFailed).toBe(true);
    expect(searched).toEqual(["original query", "original query", "original query"]);
  });

  it("spends the search request allowance in order and skips later phases at the cap", async () => {
    const phases: string[] = [];
    let checks = 0;
    await executeOsintSearchPhases(
      async () => {
        phases.push("main");
      },
      () => [{ language: "az", query: "main", domains: ["apa.az"] }],
      [{ language: "az", query: "variant" }],
      () => ++checks === 1,
      async (name) => {
        phases.push(name);
      },
    );
    expect(phases).toEqual(["main", "registry"]);
  });

  it("reserves request allowance for every language before retries or fallback can consume it", () => {
    const parent = new SearchRequestBudget(24);
    const main = partitionSearchRequestBudget(parent, 8);
    for (const task of main) task.reserve();
    expect(parent.calls).toBe(8);
    const registry = partitionSearchRequestBudget(parent, 8);
    for (const task of registry) task.reserve();
    expect(parent.calls).toBe(16);
    const variants = partitionSearchRequestBudget(parent, 8);
    for (const task of variants) task.reserve();
    expect(parent.calls).toBe(24);
  });

  it("classifies 429, timeout, invalid JSON, and language failures distinctly", () => {
    expect(osintFailureCategory(new GeminiQuotaExceededError("AI_LIGHT_MODEL", "per-minute"))).toBe(
      "rate_limit",
    );
    expect(osintFailureCategory(new SyntaxError("invalid response body"))).toBe("invalid_json");
    expect(osintFailureCategory(new Error("summary language validation failed"))).toBe("language");
    expect(compactFallbackReason(new ExaRequestError(429))).toBe("rate_limit");
    expect(compactFallbackReason(new Error("Page request timeout"))).toBe("timeout");
  });

  it("uses Tavily fallback only for Exa technical failures", () => {
    expect(searchFallbackReason(new Error("Page request timeout"))).toBe("timeout");
    expect(searchFallbackReason(new TypeError("fetch failed"))).toBe("network");
    expect(searchFallbackReason(new ExaRequestError(402))).toBe("402");
    expect(searchFallbackReason(new ExaRequestError(429))).toBe("429");
    expect(searchFallbackReason(new ExaRequestError(503))).toBe("503");
    expect(searchFallbackReason(new ExaRequestError(401))).toBeUndefined();
  });

  it("classifies only confident unregistered domain types and hides the rest", () => {
    expect(inferUnregisteredSourceType("defense.gov")).toBe("official");
    expect(inferUnregisteredSourceType("regional-news.example")).toBe("media");
    expect(inferUnregisteredSourceType("policy-research.example")).toBe("think_tank");
    expect(inferUnregisteredSourceType("unlisted.example")).toBe("other");
  });

  it("applies registry, then structural, then cached model, then heuristic classification", () => {
    const classified = new Map([
      [
        "model-only.example",
        {
          domain: "model-only.example",
          type: "academic" as const,
          source: "model" as const,
          classifiedAt: new Date(),
        },
      ],
      [
        "regional-news.example",
        {
          domain: "regional-news.example",
          type: "other" as const,
          source: "model" as const,
          classifiedAt: new Date(),
        },
      ],
    ]);
    expect(statusFor("www.reuters.com", "en", classified).type).toBe("agency");
    expect(statusFor("doi.org", "en", classified).type).toBe("resolver");
    expect(statusFor("web.archive.org", "en", classified).type).toBe("archive");
    expect(statusFor("model-only.example", "en", classified)).toEqual({
      type: "academic",
      affiliation: "model-based classification",
    });
    expect(statusFor("regional-news.example", "en", classified).type).toBe("media");
    expect(statusFor("unlisted.example", "en", classified)).toEqual({ type: "other" });
  });
});
