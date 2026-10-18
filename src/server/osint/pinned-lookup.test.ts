import { describe, expect, it } from "vitest";

import { createPinnedLookup } from "./pinned-lookup";

describe("pinned DNS lookup callback", () => {
  it("returns an address array when Node requests all DNS records", async () => {
    const lookup = createPinnedLookup("203.0.113.8", 4);
    const result = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        lookup("example.test", { all: true }, (error, address) => {
          if (error) reject(error);
          else if (Array.isArray(address)) resolve(address);
          else reject(new Error("all lookup returned a single address"));
        });
      },
    );

    expect(result).toEqual([{ address: "203.0.113.8", family: 4 }]);
  });

  it("keeps the single-address callback shape for ordinary lookups", async () => {
    const lookup = createPinnedLookup("2001:4860:4860::8888", 6);
    const result = await new Promise<{ address: string; family: number | undefined }>(
      (resolve, reject) => {
        lookup("example.test", {}, (error, address, family) => {
          if (error) reject(error);
          else if (typeof address === "string") resolve({ address, family });
          else reject(new Error("single lookup returned address records"));
        });
      },
    );

    expect(result).toEqual({ address: "2001:4860:4860::8888", family: 6 });
  });
});
