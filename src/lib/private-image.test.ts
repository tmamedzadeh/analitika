// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { loadPrivateImage } from "./private-image";
import { createHash } from "node:crypto";

describe("authenticated large image delivery", () => {
  it("assembles >4.5MB unchanged through bounded private responses", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 17);
    bytes[0] = 137;
    bytes[bytes.length - 1] = 42;
    const request = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.cache).toBe("no-store");
      expect(options.credentials).toBe("same-origin");
      const match = /bytes=(\d+)-(\d+)/.exec(
        (options.headers as Record<string, string>)["range"]!,
      )!;
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      expect(end - start + 1).toBeLessThanOrEqual(1024 * 1024);
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          "content-range": `bytes ${start}-${end}/${bytes.length}`,
          "content-type": "image/png",
        },
      });
    });
    vi.stubGlobal("fetch", request);
    const blob = await loadPrivateImage(
      "/api/attachments/document/parent/photo?original=1",
      new AbortController().signal,
    );
    expect(blob.size).toBe(bytes.length);
    expect(
      createHash("sha256")
        .update(new Uint8Array(await blob.arrayBuffer()))
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("stops at revoked access and rejects external storage URLs", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      loadPrivateImage("https://storage.invalid/private-key", new AbortController().signal),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      loadPrivateImage("/api/attachments/brief/parent/photo", new AbortController().signal),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
