import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: null as unknown,
  database: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (mocks.result ? [{ result: mocks.result }] : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: { result: unknown }) => ({
        onConflictDoUpdate: vi.fn(async () => {
          mocks.result = value.result;
        }),
      })),
    })),
  },
}));

vi.mock("@/server/db", () => ({ getDb: () => mocks.database }));

import {
  cachedQueryExpansions,
  createQueryExpansionCacheKey,
  generateQueryExpansionsWithFallback,
  normalizeQueryExpansions,
  QUERY_EXPANSION_HTTP_TIMEOUT_MS,
  queryExpansionMainSchema,
  queryExpansionsSchema,
} from "./query-expansion";
import { OSINT_LANGUAGES } from "@/lib/osint";

describe("OSINT structured query expansion", () => {
  beforeEach(() => {
    mocks.result = null;
    vi.clearAllMocks();
  });

  it("validates one expansion object for every selected language", () => {
    const languages = ["az", "en", "ru"] as const;
    const schema = queryExpansionsSchema(languages);
    expect(
      schema.parse({
        az: { main: "sor\u011fu", variants: ["alternativ"] },
        en: { main: "query", variants: [] },
        ru: { main: "query ru", variants: [] },
      }),
    ).toMatchObject({
      az: { main: "sor\u011fu" },
      en: { main: "query" },
      ru: { main: "query ru" },
    });
    expect(() =>
      schema.parse({
        az: { main: "sor\u011fu", variants: ["a", "b", "c"] },
        en: { main: "query", variants: [] },
        ru: { main: "query ru", variants: [] },
      }),
    ).toThrow();
  });

  it("uses a compact main-only schema for a single fallback across translated languages", () => {
    const schema = queryExpansionMainSchema(["fa", "hy", "en"]);
    expect(schema.parse({ fa: "فارسی", hy: "հայերեն", en: "English" })).toEqual({
      fa: "فارسی",
      hy: "հայերեն",
      en: "English",
    });
    expect(() => schema.parse({ fa: "فارسی", hy: "հայերեն" })).toThrow();
    expect(() =>
      schema.parse({ fa: "فارسی", hy: "հայերեն", en: "English", az: "query" }),
    ).toThrow();
  });

  it("keeps low-mode HTTP attempts at 30 seconds independently of the step budget", () => {
    expect(QUERY_EXPANSION_HTTP_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("makes one fallback call for all translated languages and preserves az verbatim", async () => {
    const languages = OSINT_LANGUAGES;
    const fallbackLanguages = languages.filter(
      (language): language is Exclude<(typeof languages)[number], "az"> => language !== "az",
    );
    const primary = vi.fn(async () => {
      throw new Error("primary request failed");
    });
    const fallback = vi.fn(async (requested: readonly string[]) => {
      expect(requested).toEqual(fallbackLanguages);
      return Object.fromEntries(requested.map((language) => [language, "query " + language]));
    });

    const result = await generateQueryExpansionsWithFallback(
      "original query",
      languages,
      primary,
      fallback,
    );

    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
    expect(result.fallbackFailed).toBe(false);
    expect(result.fallbackLanguages).toEqual(fallbackLanguages);
    expect(result.expansions.az).toEqual({ main: "original query", variants: [] });
    expect(result.expansions.en).toEqual({ main: "query en", variants: [] });
  });

  it("uses original queries for all unexpanded languages after one failed fallback", async () => {
    const languages = ["az", "ru", "fr"] as const;
    const fallback = vi.fn(async () => {
      throw new Error("fallback failed");
    });
    const result = await generateQueryExpansionsWithFallback(
      "original query",
      languages,
      async () => {
        throw new Error("primary failed");
      },
      fallback,
    );
    expect(fallback).toHaveBeenCalledOnce();
    expect(result.fallbackFailed).toBe(true);
    expect(result.fallbackLanguages).toEqual(["ru", "fr"]);
    expect(Object.values(result.expansions).map((expansion) => expansion.main)).toEqual([
      "original query",
      "original query",
      "original query",
    ]);
  });

  it("keys cached expansions by normalized query, full language set, model, and prompt version", () => {
    const key = createQueryExpansionCacheKey("  A   Query ", ["en", "az"], "gemini-main", 2);
    expect(createQueryExpansionCacheKey("a query", ["az", "en"], "gemini-main", 2)).toBe(key);
    expect(createQueryExpansionCacheKey("a query", ["az", "en"], "gemini-light", 2)).not.toBe(key);
    expect(createQueryExpansionCacheKey("a query", ["az"], "gemini-main", 2)).not.toBe(key);
    expect(createQueryExpansionCacheKey("a query", ["az", "en"], "gemini-main", 3)).not.toBe(key);
    expect(key).not.toContain("a query");
  });

  it("keeps the original Azerbaijani query and removes duplicate variants", () => {
    const languages = ["az", "en"] as const;
    const normalized = normalizeQueryExpansions(
      {
        az: { main: "translated Azerbaijani", variants: ["variant", "variant"] },
        en: { main: "English query", variants: [] },
      },
      "original request",
      languages,
    );
    expect(normalized.az).toEqual({ main: "original request", variants: ["variant"] });
    expect(normalized.en.main).toBe("English query");
  });

  it("persists and reuses expansion results without an in-memory cache", async () => {
    const languages = ["az", "en"] as const;
    const generate = vi.fn().mockResolvedValue({
      az: { main: "ignored", variants: ["alternativ"] },
      en: { main: "English query", variants: [] },
    });
    const first = await cachedQueryExpansions(
      "original request",
      languages,
      "gemini-main",
      generate,
    );
    const second = await cachedQueryExpansions(
      "original request",
      languages,
      "gemini-main",
      generate,
    );
    expect(first).toEqual(second);
    expect(first.az.main).toBe("original request");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(mocks.database.insert).toHaveBeenCalledTimes(1);
  });
});
