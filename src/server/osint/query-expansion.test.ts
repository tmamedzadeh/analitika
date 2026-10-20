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
  normalizeQueryExpansions,
  queryExpansionsSchema,
} from "./query-expansion";

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
    const first = await cachedQueryExpansions("original request", languages, generate);
    const second = await cachedQueryExpansions("original request", languages, generate);
    expect(first).toEqual(second);
    expect(first.az.main).toBe("original request");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(mocks.database.insert).toHaveBeenCalledTimes(1);
  });
});
