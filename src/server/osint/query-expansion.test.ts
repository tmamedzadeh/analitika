import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cachedQueryExpansion,
  clearQueryExpansionCache,
  parseQueryExpansion,
} from "./query-expansion";

describe("OSINT query expansion", () => {
  beforeEach(() => clearQueryExpansionCache());

  it("accepts a strict main query and at most two useful variants", () => {
    expect(
      parseQueryExpansion(
        '{"main":"tensions in Georgia","variants":["Georgia border talks","Georgia military exercise"]}',
        "original",
      ),
    ).toEqual({
      main: "tensions in Georgia",
      variants: ["Georgia border talks", "Georgia military exercise"],
    });
    expect(
      parseQueryExpansion('{"main":"topic","variants":["topic","other"]}', "original").variants,
    ).toEqual(["other"]);
  });

  it("uses only the fallback main query for invalid JSON and never attempts repair", async () => {
    expect(parseQueryExpansion("not json", "fallback query")).toEqual({
      main: "fallback query",
      variants: [],
    });
    const generate = vi.fn().mockResolvedValue("not json");
    await expect(cachedQueryExpansion("topic", "ka", "fallback query", generate)).resolves.toEqual({
      main: "fallback query",
      variants: [],
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("caches an expansion by query and language", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue('{"main":"topic ru","variants":["topic ru source"]}');
    await cachedQueryExpansion("topic", "ru", "fallback", generate);
    await cachedQueryExpansion(" topic ", "ru", "fallback", generate);
    await cachedQueryExpansion("topic", "fa", "fallback", generate);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
