import { createHash } from "node:crypto";
import { imageMimeFromSignature, MAX_BRIEF_PHOTO_BYTES } from "@/lib/briefs";
import { ImageOperationError } from "./operations";

export const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_IMAGE_DIMENSION = 16_384;
let processor: Promise<(typeof import("sharp"))["default"]> | undefined;
function imageProcessor() {
  processor ??= import("sharp")
    .then(({ default: sharp }) => {
      sharp.cache(false);
      sharp.concurrency(1);
      return sharp;
    })
    .catch((error) => {
      processor = undefined;
      throw error;
    });
  return processor;
}
let processing = 0;

/** Sequential per batch; cap parallel decoders per Node instance. No remote image service. */
export async function optimizeImage(bytes: Uint8Array, mime: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (
    bytes.length < 1 ||
    bytes.length > MAX_BRIEF_PHOTO_BYTES ||
    imageMimeFromSignature(bytes) !== mime
  )
    throw new ImageOperationError("validation");
  if (processing >= 2) throw new ImageOperationError("busy", true);
  processing++;
  try {
    // Native codec availability must not prevent reading existing application data.
    // New uploads fail closed if validation cannot run.
    const sharp = await imageProcessor();
    const decoder = sharp(bytes, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      limitInputChannels: 4,
      failOn: "warning",
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    signal?.throwIfAborted();
    const { width, height } = metadata;
    const format = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[mime];
    if (
      !width ||
      !height ||
      width * height > MAX_IMAGE_PIXELS ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      (metadata.pages ?? 1) > 1 ||
      metadata.format !== format
    )
      throw new ImageOperationError("validation");
    // Force bounded decoding as well as header validation, including for original WebP.
    await decoder.clone().resize(1, 1).timeout({ seconds: 5 }).raw().toBuffer();
    signal?.throwIfAborted();
    const original = { width, height, sha256: createHash("sha256").update(bytes).digest("hex") };
    // A WebP upload is already encoded for display. Preserve its quality and bytes.
    if (mime === "image/webp") return { ...original, derivative: null };
    try {
      const { data, info } = await decoder
        .clone()
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 3 })
        .timeout({ seconds: 5 })
        .toBuffer({ resolveWithObject: true });
      // Require a meaningful saving. Sharp strips derivative metadata by default.
      return {
        ...original,
        derivative:
          data.length < bytes.length * 0.95
            ? { bytes: data, width: info.width, height: info.height }
            : null,
      };
    } catch {
      // Original has already passed decoding. Conversion failure cannot bypass validation.
      return { ...original, derivative: null };
    }
  } catch (error) {
    if (error instanceof ImageOperationError) throw error;
    const invalid =
      error instanceof Error && /input|invalid|corrupt|exceeds|png|jpeg|webp/i.test(error.message);
    throw new ImageOperationError(invalid ? "validation" : "processor", !invalid);
  } finally {
    processing--;
  }
}
