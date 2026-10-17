import { describe, expect, it, vi } from "vitest";

import { parseRerankResponse, rerankOrderOrOriginal, type RerankCandidate } from "./rerank";

const candidates: RerankCandidate[] = [
  { id: "rrf-1", excerpt: "Birinci fraqment" },
  { id: "rrf-2", excerpt: "İkinci fraqment" },
  { id: "rrf-3", excerpt: "Üçüncü fraqment" },
];

describe("parseRerankResponse", () => {
  it("extracts JSON when the model surrounds it with junk", () => {
    expect(
      parseRerankResponse('noise {"ids":["rrf-3","rrf-1"]} tail', ["rrf-1", "rrf-2", "rrf-3"]),
    ).toEqual(["rrf-3", "rrf-1", "rrf-2"]);
  });

  it("ignores IDs that are not candidates", () => {
    expect(parseRerankResponse('{"ids":["outside","rrf-2"]}', ["rrf-1", "rrf-2"])).toEqual([
      "rrf-2",
      "rrf-1",
    ]);
  });

  it("removes duplicate IDs", () => {
    expect(parseRerankResponse('{"ids":["rrf-2","rrf-2","rrf-1"]}', ["rrf-1", "rrf-2"])).toEqual([
      "rrf-2",
      "rrf-1",
    ]);
  });

  it("adds omitted candidate IDs in their RRF order", () => {
    expect(parseRerankResponse('{"ids":["rrf-3"]}', ["rrf-1", "rrf-2", "rrf-3"])).toEqual([
      "rrf-3",
      "rrf-1",
      "rrf-2",
    ]);
  });

  it("falls back to RRF order for invalid JSON", () => {
    expect(parseRerankResponse("not JSON", ["rrf-1", "rrf-2"])).toEqual(["rrf-1", "rrf-2"]);
  });
});

describe("rerankOrderOrOriginal", () => {
  it("preserves the RRF order when disabled", async () => {
    const rerank = vi.fn(async () => ["rrf-3", "rrf-1", "rrf-2"]);
    const result = await rerankOrderOrOriginal("sual", candidates, { rerank }, false);
    expect(result).toEqual(["rrf-1", "rrf-2", "rrf-3"]);
    expect(rerank).not.toHaveBeenCalled();
  });

  it("falls back to RRF order when the provider times out", async () => {
    const provider = { rerank: vi.fn(() => new Promise<readonly string[]>(() => undefined)) };
    const result = await rerankOrderOrOriginal("sual", candidates, provider, true, 10);
    expect(result).toEqual(["rrf-1", "rrf-2", "rrf-3"]);
    expect(provider.rerank).toHaveBeenCalledOnce();
  });

  it("falls back to RRF order when the provider fails", async () => {
    const provider = { rerank: vi.fn(async () => Promise.reject(new Error("429"))) };
    const result = await rerankOrderOrOriginal("sual", candidates, provider, true);
    expect(result).toEqual(["rrf-1", "rrf-2", "rrf-3"]);
  });
});
