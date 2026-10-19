import { describe, expect, it, vi } from "vitest";

import {
  ExaProvider,
  SearchRequestBudget,
  SearchRequestBudgetExceededError,
  parseExaSearchResponse,
} from "./exa";

describe("Exa search provider", () => {
  it("parses supported source fields and skips malformed entries", () => {
    expect(
      parseExaSearchResponse({
        results: [
          {
            url: "https://example.org/report",
            title: "Report",
            publishedDate: "2026-10-01",
            text: "Full article text",
            highlights: ["Highlight"],
          },
          { url: "", title: "invalid" },
          null,
        ],
      }),
    ).toEqual([
      {
        url: "https://example.org/report",
        title: "Report",
        publishedDate: "2026-10-01",
        publishedAt: "2026-10-01",
        text: "Full article text",
        highlights: ["Highlight"],
        snippet: "Highlight",
        index: 1,
        providerRank: 1,
        provider: "exa",
        providers: ["exa"],
      },
    ]);
  });

  it("sends country context, date bounds, domain filters and a maximum of ten results", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new ExaProvider("test-only-key", request);
    await provider.search({
      query: "regional talks",
      language: "fa",
      userLocation: "IR",
      numResults: 15,
      includeDomains: ["example.org"],
      startPublishedDate: "2026-09-01T00:00:00.000Z",
      endPublishedDate: "2026-10-01T00:00:00.000Z",
    });
    const [, init] = request.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body["numResults"]).toBe(10);
    expect(body["userLocation"]).toBe("IR");
    expect(body["startPublishedDate"]).toBe("2026-09-01T00:00:00.000Z");
    expect(body["endPublishedDate"]).toBe("2026-10-01T00:00:00.000Z");
    expect(body["includeDomains"]).toEqual(["example.org"]);
    expect(init?.headers).toMatchObject({ "x-api-key": "test-only-key" });
  });

  it("counts provider retries against the request budget", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      );
    const provider = new ExaProvider("test-only-key", request);
    const budget = new SearchRequestBudget(1);
    await expect(
      provider.search({ query: "q", language: "en", limit: 5, requestBudget: budget }),
    ).rejects.toBeInstanceOf(SearchRequestBudgetExceededError);
    expect(budget.calls).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retries one Exa 5xx when permitted and honors the shared request budget", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("temporary failure", { status: 503, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new ExaProvider("test-only-key", request);
    const budget = new SearchRequestBudget(2);
    await provider.search({ query: "q", language: "en", requestBudget: budget });
    expect(request).toHaveBeenCalledTimes(2);
    expect(budget.calls).toBe(2);
  });

  it("surfaces a timeout so the configured fallback can run", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("request timed out", "TimeoutError"));
    const provider = new ExaProvider("test-only-key", request);
    await expect(provider.search({ query: "q", language: "en" })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});
