import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    "select",
    "from",
    "where",
    "limit",
    "insert",
    "values",
    "onConflictDoUpdate",
  ]) {
    chain[method] = vi.fn();
  }
  for (const method of ["select", "from", "where", "insert", "values"]) {
    chain[method]!.mockImplementation(() => chain);
  }
  return {
    chain,
    getDb: vi.fn(() => chain),
    fetchPublicPage: vi.fn(),
  };
});

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("./fetch-public-page", () => ({ fetchPublicPage: mocks.fetchPublicPage }));

import { fetchCachedPublicPage } from "./page-cache";
import { readOsintSearchCache } from "./search-cache";

describe("OSINT caches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(mocks.chain);
    mocks.chain["limit"]!.mockResolvedValue([]);
  });

  it("returns a cached search result without losing snippet metadata", async () => {
    const result = {
      url: "https://example.org/report",
      title: "Report",
      snippet: "Search excerpt",
      highlights: ["Search excerpt"],
      index: 1,
      provider: "exa",
      providers: ["exa"],
    };
    mocks.chain["limit"]!.mockResolvedValueOnce([{ results: [result] }]);

    await expect(
      readOsintSearchCache({
        provider: "exa",
        language: "en",
        query: "report query",
        period: "7d",
      }),
    ).resolves.toEqual([result]);
  });

  it("reuses a full-text page cache entry without refetching the page", async () => {
    const text = "Verified article text ".repeat(60);
    mocks.chain["limit"]!.mockResolvedValueOnce([
      {
        normalizedUrl: "https://example.org/report",
        text,
        title: "Cached report",
        publishedAt: null,
        language: "en",
        status: "fetched_full",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    await expect(
      fetchCachedPublicPage("https://www.example.org/report/?utm_source=test#top", "en"),
    ).resolves.toMatchObject({ fetched: true, title: "Cached report", text });
    expect(mocks.fetchPublicPage).not.toHaveBeenCalled();
  });
});
