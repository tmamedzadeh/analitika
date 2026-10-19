import { describe, expect, it, vi } from "vitest";

import { ExaRequestError } from "./exa";
import { searchFallbackReason, searchWithFallback } from "./provider-fallback";
import type { SearchProvider, SearchSource } from "./types";

const source: SearchSource = { url: "https://example.com/a", title: "Example", index: 1 };
const provider = (id: "exa" | "tavily"): SearchProvider => ({
  provider: id,
  search: async () => [source],
});

describe("provider fallback", () => {
  it("tries Tavily after an eligible Exa error and returns the fallback source", async () => {
    const exa = provider("exa");
    const tavily = provider("tavily");
    const execute = vi.fn(async (candidate: SearchProvider) => {
      if (candidate.provider === "exa") throw new ExaRequestError(429);
      return [source];
    });
    const onFallback = vi.fn();

    await expect(searchWithFallback(exa, tavily, execute, onFallback)).resolves.toEqual({
      provider: "tavily",
      results: [source],
      fallbackReason: "429",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(onFallback).toHaveBeenCalledWith("429");
  });

  it("does not use Tavily for non-technical Exa failures", async () => {
    const execute = vi.fn(async (candidate: SearchProvider) => {
      if (candidate.provider === "exa") throw new ExaRequestError(401);
      return [source];
    });
    await expect(searchWithFallback(provider("exa"), provider("tavily"), execute)).rejects.toThrow(
      "401",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed Tavily request after invoking fallback", async () => {
    const execute = vi.fn(async (candidate: SearchProvider) => {
      if (candidate.provider === "exa") throw new ExaRequestError(503);
      throw new Error("Tavily unavailable");
    });
    await expect(searchWithFallback(provider("exa"), provider("tavily"), execute)).rejects.toThrow(
      "Tavily unavailable",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new ExaRequestError(402), "402"],
    [new ExaRequestError(429), "429"],
    [new ExaRequestError(503), "503"],
    [new Error("request timeout"), "timeout"],
    [new TypeError("fetch failed"), "network"],
  ])("classifies eligible Exa failure %s", (error, expected) => {
    expect(searchFallbackReason(error)).toBe(expected);
  });
});
