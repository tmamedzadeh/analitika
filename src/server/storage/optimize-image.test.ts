// @vitest-environment node
import sharp from "sharp";
import { randomBytes, createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { optimizeImage, MAX_IMAGE_PIXELS } from "./optimize-image";
import { commitImageUploads, newImageUploadKey } from "./image-uploads";
import { attachmentKeys } from "./image-metadata";
import type { StorageProvider } from "./types";

describe("original bytes + bounded private display WebP", () => {
  it("honors EXIF orientation without changing the original", async () => {
    const original = await sharp(randomBytes(800 * 400 * 3), {
      raw: { width: 800, height: 400, channels: 3 },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
    const result = await optimizeImage(original, "image/jpeg");
    expect(result.derivative).not.toBeNull();
    expect(result.derivative).toMatchObject({ width: 400, height: 800 });
    expect(result.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect((await sharp(original).metadata()).orientation).toBe(6);
  });
  it("preserves transparent and partially transparent pixels in display WebP", async () => {
    const raw = randomBytes(300 * 200 * 4);
    for (let index = 3; index < raw.length; index += 4) raw[index] = index % 8 === 3 ? 0 : 128;
    const original = await sharp(raw, { raw: { width: 300, height: 200, channels: 4 } })
      .png()
      .toBuffer();
    const result = await optimizeImage(original, "image/png");
    expect(result.derivative).not.toBeNull();
    const pixels = await sharp(result.derivative!.bytes).ensureAlpha().raw().toBuffer();
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(128);
  });
  it("produces a smaller, limited-size derivative and hashes the unchanged original", async () => {
    const original = await sharp(randomBytes(1800 * 1000 * 3), {
      raw: { width: 1800, height: 1000, channels: 3 },
    })
      .png()
      .toBuffer();
    const result = await optimizeImage(original, "image/png");
    expect(result.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(result.derivative).not.toBeNull();
    expect(result.derivative!.bytes.length).toBeLessThan(original.length * 0.95);
    expect(result.derivative!.width).toBe(1600);
    expect((await sharp(result.derivative!.bytes).metadata()).format).toBe("webp");
  });
  it("avoids recompressing WebP and falls back when conversion increases size", async () => {
    const original = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "white" },
    })
      .webp()
      .toBuffer();
    expect((await optimizeImage(original, "image/webp")).derivative).toBeNull();
    const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
      .jpeg()
      .toBuffer();
    const result = await optimizeImage(jpeg, "image/jpeg");
    if (result.derivative) expect(result.derivative.bytes.length).toBeLessThan(jpeg.length * 0.95);
    const compactJpeg = await sharp(randomBytes(320 * 240 * 3), {
      raw: { width: 320, height: 240, channels: 3 },
    })
      .jpeg({ quality: 10 })
      .toBuffer();
    expect((await optimizeImage(compactJpeg, "image/jpeg")).derivative).toBeNull();
  });
  it("uses only a successfully validated original when the WebP encoder is unavailable", async () => {
    const original = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const encoder = vi.spyOn(sharp.prototype, "webp").mockImplementation(() => {
      throw new Error("Synthetic unavailable WebP encoder");
    });
    try {
      const result = await optimizeImage(original, "image/png");
      expect(result.derivative).toBeNull();
      expect(result.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    } finally {
      encoder.mockRestore();
    }
  });
  it("rejects wrong MIME, truncated data, excessive dimensions, pixels and byte size", async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    await expect(optimizeImage(image, "image/jpeg")).rejects.toThrow();
    await expect(optimizeImage(image.subarray(0, 12), "image/png")).rejects.toThrow();
    await expect(
      optimizeImage(new Uint8Array(10 * 1024 * 1024 + 1), "image/png"),
    ).rejects.toThrow();
    const wide = await sharp({
      create: { width: 17000, height: 1, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(optimizeImage(wide, "image/png")).rejects.toThrow();
    const large = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect(4001 * 4000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    await expect(optimizeImage(large, "image/png")).rejects.toThrow();
  });
  it("keeps the validated original after an optional derivative PUT failure", async () => {
    const bytes = await sharp(randomBytes(300 * 200 * 3), {
      raw: { width: 300, height: 200, channels: 3 },
    })
      .png()
      .toBuffer();
    const key = newImageUploadKey("documents", "parent", "owner", "image/png");
    const objects = new Set([key]);
    const storage = {
      getObjectStream: async () => ({
        size: bytes.length,
        contentType: "image/png",
        body: new ReadableStream({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      }),
      put: vi.fn(async ({ key: next }: { key: string }) => {
        objects.add(next);
        if (next.endsWith(".display.webp")) throw new Error("Synthetic partial PUT");
      }),
      delete: vi.fn(async (next: string) => {
        objects.delete(next);
      }),
    } as unknown as StorageProvider;
    const [saved] = await commitImageUploads(storage, "documents", "parent", "owner", [
      { key, size: bytes.length, mime: "image/png" },
    ]);
    expect(saved!.imageMetadata.derivative).toBeNull();
    expect(objects.has(saved!.key)).toBe(true);
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it("lists originals for legacy attachments and both objects for new attachments", () => {
    expect(attachmentKeys({ storageKey: "original" })).toEqual(["original"]);
    expect(
      attachmentKeys({
        storageKey: "original",
        imageMetadata: {
          width: 1,
          height: 1,
          sha256: "digest",
          derivative: { key: "display", mime: "image/webp", width: 1, height: 1, size: 10 },
        },
      }),
    ).toEqual(["original", "display"]);
  });
});
