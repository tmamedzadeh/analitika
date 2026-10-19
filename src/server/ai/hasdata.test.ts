import { describe, expect, it, vi } from "vitest";

import { HasDataProvider, parseHasDataResponse } from "./hasdata";

describe("HasData evaluation provider", () => {
  it("uses the light endpoint by default and sends Google language and country codes", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          organicResults: [
            { link: "https://example.org/a", title: "A", snippet: "Short extract", position: 2 },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new HasDataProvider("test-only-key", "light", request);
    const result = await provider.search({
      query: "regional talks",
      language: "ka",
      country: "GE",
      numResults: 10,
    });
    const [url, init] = request.mock.calls[0]!;
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.pathname).toBe("/scrape/google-light/serp");
    expect(parsedUrl.searchParams.get("hl")).toBe("ka");
    expect(parsedUrl.searchParams.get("gl")).toBe("ge");
    expect(parsedUrl.searchParams.get("num")).toBe("10");
    expect(init?.headers).toMatchObject({ "x-api-key": "test-only-key" });
    expect(result[0]?.providers).toEqual(["hasdata"]);
  });

  it("supports full SERP only as an explicitly selected evaluation mode", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ organicResults: [] }), { status: 200 }));
    await new HasDataProvider("test-only-key", "full", request).search({
      query: "q",
      language: "zh",
    });
    expect(String(request.mock.calls[0]?.[0])).toContain("/scrape/google/serp?");
  });

  it("ignores malformed result rows and leaves text as a snippet", () => {
    expect(
      parseHasDataResponse({
        organicResults: [null, { link: "https://example.org", snippet: "snippet" }],
      }),
    ).toEqual([
      {
        url: "https://example.org",
        title: "https://example.org",
        highlights: ["snippet"],
        snippet: "snippet",
        index: 2,
        providerRank: 2,
        provider: "hasdata",
        providers: ["hasdata"],
      },
    ]);
  });
});
