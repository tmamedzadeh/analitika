import { imageMimeFromSignature, MAX_BRIEF_PHOTO_BYTES } from "@/lib/briefs";
import { optimizeImage } from "./optimize-image";
import { attachmentKeys, type ImageMetadata } from "./image-metadata";
import { ImageOperationError, operationScope, readStorageBytes } from "./operations";
import type { StorageProvider, StorageOptions } from "./types";

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
  options: StorageOptions & {
    beforeWrite?: (key: string) => Promise<void>;
    requestId?: string;
  } = {},
): Promise<Array<T & { imageMetadata: ImageMetadata }>> {
  const committed: Array<T & { imageMetadata: ImageMetadata }> = [];
  const scope = operationScope(options, 45_000);
  const requestId = options.requestId ?? crypto.randomUUID();
  const started = Date.now();
  const stage = (name: string) =>
    console.info("image.operation", { requestId, stage: name, elapsedMs: Date.now() - started });
  try {
    for (const upload of uploads) {
      if (
        !isOwnedImageUploadKey(kind, parentId, userId, upload.key, upload.mime) ||
        upload.size < 1 ||
        upload.size > MAX_BRIEF_PHOTO_BYTES
      )
        throw new ImageOperationError("validation");
      scope.signal.throwIfAborted();
      const context = { signal: scope.signal };
      const object = await storage.getObjectStream(upload.key, context);
      stage("storage-read-headers");
      if (
        (object.size !== undefined && object.size !== upload.size) ||
        (object.contentType && object.contentType !== upload.mime)
      ) {
        await object.body.cancel();
        throw new ImageOperationError("validation");
      }
      const bytes = await readStorageBytes(object.body, upload.size, context);
      stage("storage-read-complete");
      if (imageMimeFromSignature(bytes) !== upload.mime)
        throw new ImageOperationError("validation");
      const key = `${kind}/${parentId}/committed/${crypto.randomUUID()}.${extensions[upload.mime]}`;
      const optimized = await optimizeImage(bytes, upload.mime, scope.signal);
      stage("image-validated");
      const derivative = optimized.derivative
        ? {
            key: key + ".display.webp",
            mime: "image/webp" as const,
            size: optimized.derivative.bytes.length,
            width: optimized.derivative.width,
            height: optimized.derivative.height,
          }
        : null;
      const imageMetadata: ImageMetadata = {
        width: optimized.width,
        height: optimized.height,
        sha256: optimized.sha256,
        derivative,
      };
      // Track before PUT: a transport error can occur after the object was stored.
      committed.push({ ...upload, key, imageMetadata });
      await options.beforeWrite?.(key);
      await storage.put({ key, body: bytes, contentType: upload.mime }, context);
      stage("original-stored");
      if (derivative && optimized.derivative) {
        await options.beforeWrite?.(derivative.key);
        try {
          await storage.put(
            {
              key: derivative.key,
              body: optimized.derivative.bytes,
              contentType: "image/webp",
            },
            context,
          );
        } catch {
          imageMetadata.derivative = null;
          stage("optional-webp-unavailable");
        }
      }
      scope.signal.throwIfAborted();
    }
    return committed;
  } catch (error) {
    stage("failed");
    await Promise.allSettled(
      committed
        .flatMap((file) =>
          attachmentKeys({ storageKey: file.key, imageMetadata: file.imageMetadata }),
        )
        .map((key) => storage.delete(key)),
    );
    throw error;
  } finally {
    // Retryable staging is retained. Only the reference-aware sweep removes it.
    scope.dispose();
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
