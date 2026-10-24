import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { commitImageUploads, discardImageUploads, newImageUploadKey } from "./image-uploads";
import type { StorageProvider } from "./types";

let png: Uint8Array;
beforeAll(async () => {
  png = new Uint8Array(
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
      .png()
      .toBuffer(),
  );
});
function fixture() {
  const objects = new Map<string, Uint8Array>();
  const storage = {
    getObjectStream: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing object");
      return {
        size: bytes.length,
        contentType: "image/png",
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      };
    }),
    put: vi.fn(async ({ key, body }: { key: string; body: Uint8Array }) => {
      objects.set(key, body.slice());
    }),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  } as unknown as StorageProvider;
  const key = newImageUploadKey("briefs", "parent", "owner", "image/png");
  objects.set(key, png);
  return { storage, objects, upload: { key, mime: "image/png" as const, size: png.length } };
}
describe("immutable image attachments", () => {
  it("keeps committed bytes after staging overwrite and discard", async () => {
    const { storage, objects, upload } = fixture();
    const [committed] = await commitImageUploads(storage, "briefs", "parent", "owner", [upload]);
    expect(committed!.key).not.toBe(upload.key);
    objects.set(upload.key, new Uint8Array([1, 2, 3]));
    await discardImageUploads(storage, "briefs", "parent", "owner", [upload.key]);
    expect(objects.get(committed!.key)).toEqual(png);
    await expect(
      discardImageUploads(storage, "briefs", "parent", "owner", [committed!.key]),
    ).rejects.toThrow();
    expect(objects.get(committed!.key)).toEqual(png);
  });
  it("rejects a different owner or parent before reading or deleting objects", async () => {
    const { storage, upload } = fixture();
    for (const [parent, user] of [
      ["parent", "other"],
      ["other", "owner"],
    ]) {
      await expect(
        commitImageUploads(storage, "briefs", parent!, user!, [upload]),
      ).rejects.toThrow();
      await expect(
        discardImageUploads(storage, "briefs", parent!, user!, [upload.key]),
      ).rejects.toThrow();
    }
    expect(storage.getObjectStream).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it("rejects size/type/signature mismatch and removes earlier copies on batch failure", async () => {
    const { storage, objects, upload } = fixture();
    await expect(
      commitImageUploads(storage, "briefs", "parent", "owner", [{ ...upload, size: 1 }]),
    ).rejects.toThrow();
    const second = { ...upload, key: newImageUploadKey("briefs", "parent", "owner", "image/png") };
    objects.set(second.key, new Uint8Array(png.length));
    await expect(
      commitImageUploads(storage, "briefs", "parent", "owner", [upload, second]),
    ).rejects.toThrow();
    expect([...objects.keys()].filter((key) => key.includes("/committed/"))).toHaveLength(0);
  });
});
