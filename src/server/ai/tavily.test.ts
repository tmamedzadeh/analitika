import { describe, expect, it, vi } from "vitest";

import { SearchRequestBudget } from "./exa";
import { TavilyProvider, TavilyRequestError } from "./tavily";

describe("Tavily search provider", () => {
  it("sends documented language, country, date and domain filters", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://example.org/a",
              title: "A",
              content: "Excerpt",
              published_date: "2026-10-18",
            },
          ],
          usage: { credits: 1 },
        }),
        { status: 200 },
      ),
    );
    const provider = new TavilyProvider("test-only-key", request);
    const results = await provider.search({
      query: "regional talks",
      language: "fa",
      country: "IR",
      startPublishedDate: "2026-10-01T00:00:00.000Z",
      endPublishedDate: "2026-10-19T00:00:00.000Z",
      includeDomains: ["example.org"],
      numResults: 10,
    });
    const [, init] = request.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      query: "regional talks",
      language: "fa",
      country: "iran",
      start_date: "2026-10-01",
      end_date: "2026-10-19",
      include_domains: ["example.org"],
      max_results: 10,
      search_depth: "basic",
    });
    expect(results[0]).toMatchObject({
      url: "https://example.org/a",
      publishedDate: "2026-10-18",
      highlights: ["Excerpt"],
      provider: "tavily",
    });
    expect(provider.usageStats.credits).toBe(1);
  });

  it("retries one documented 429 and counts the retry against the shared budget", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new TavilyProvider("test-only-key", request);
    const budget = new SearchRequestBudget(2);
    await provider.search({ query: "q", language: "ka", requestBudget: budget });
    expect(request).toHaveBeenCalledTimes(2);
    expect(budget.calls).toBe(2);
  });

  it("surfaces provider 5xx errors for the production fallback handler", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("failed", { status: 503 }));
    const provider = new TavilyProvider("test-only-key", request);
    await expect(provider.search({ query: "q", language: "en" })).rejects.toBeInstanceOf(
      TavilyRequestError,
    );
  });
});
