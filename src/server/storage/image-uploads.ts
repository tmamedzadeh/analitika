import { imageMimeFromSignature, MAX_BRIEF_PHOTO_BYTES } from "@/lib/briefs";
import type { StorageProvider } from "./types";

const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
type ImageMime = keyof typeof extensions;
export type ImageUpload = { key: string; mime: ImageMime; size: number };
type Kind = "documents" | "briefs";

function ownedPrefix(kind: Kind, parentId: string, userId: string) {
  return `${kind}/${parentId}/uploads/${encodeURIComponent(userId)}/`;
}

export function newImageUploadKey(kind: Kind, parentId: string, userId: string, mime: ImageMime) {
  return `${ownedPrefix(kind, parentId, userId)}${crypto.randomUUID()}.${extensions[mime]}`;
}

export function isOwnedImageUploadKey(
  kind: Kind,
  parentId: string,
  userId: string,
  key: string,
  mime?: ImageMime,
) {
  const prefix = ownedPrefix(kind, parentId, userId);
  if (!key.startsWith(prefix)) return false;
  const suffix = key.slice(prefix.length);
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(
      suffix,
    ) &&
    (!mime || suffix.endsWith(`.${extensions[mime]}`))
  );
}

/** Signed PUT URLs remain reusable until expiry. Persist a fresh server-only copy of verified bytes. */
export async function commitImageUploads<T extends ImageUpload>(
  storage: StorageProvider,
  kind: Kind,
  parentId: string,
  userId: string,
  uploads: T[],
): Promise<T[]> {
  const committed: T[] = [];
  try {
    for (const upload of uploads) {
      if (
        !isOwnedImageUploadKey(kind, parentId, userId, upload.key, upload.mime) ||
        upload.size < 1 ||
        upload.size > MAX_BRIEF_PHOTO_BYTES
      )
        throw new Error("Invalid image upload.");
      const object = await storage.getObjectStream(upload.key);
      if (
        (object.size !== undefined && object.size !== upload.size) ||
        (object.contentType && object.contentType !== upload.mime)
      ) {
        await object.body.cancel();
        throw new Error("Image upload metadata mismatch.");
      }
      const reader = object.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > upload.size) {
            await reader.cancel();
            throw new Error("Image upload size mismatch.");
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      if (size !== upload.size || imageMimeFromSignature(bytes) !== upload.mime)
        throw new Error("Image upload signature mismatch.");
      const key = `${kind}/${parentId}/committed/${crypto.randomUUID()}.${extensions[upload.mime]}`;
      // Track before PUT: a transport error can occur after the object was stored.
      committed.push({ ...upload, key });
      await storage.put({ key, body: bytes, contentType: upload.mime });
    }
    return committed;
  } catch (error) {
    await Promise.allSettled(committed.map(({ key }) => storage.delete(key)));
    throw error;
  }
}

export async function discardImageUploads(
  storage: StorageProvider,
  kind: Kind,
  parentId: string,
  userId: string,
  keys: string[],
) {
  if (keys.some((key) => !isOwnedImageUploadKey(kind, parentId, userId, key)))
    throw new Error("Invalid image upload owner.");
  await Promise.allSettled(keys.map((key) => storage.delete(key)));
}
