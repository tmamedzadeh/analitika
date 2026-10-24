import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDocumentSchema } from "./documents.functions";
import { createTextDocument, recoverCreation } from "@/server/documents/creations";
import { dispatchCreatedDocument } from "@/server/documents/index-dispatch";
import {
  listDocumentImages,
  issueDocumentImageUrl,
  finalizeDocumentImage,
  cancelDocumentImage,
} from "@/server/storage/document-image-sessions";
import { ImageOperationError, imageErrorMessage } from "@/server/storage/operations";
import { readServerEnv } from "@/server/env";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";
import { getRequest } from "@tanstack/react-start/server";

const slotSchema = z.object({ documentId: z.string().uuid(), uploadId: z.string().uuid() });
const generationSchema = slotSchema.extend({ generation: z.number().int().positive() });
export const textCreationSchema = createDocumentSchema.extend({
  creationKey: z.string().uuid(),
  photos: createDocumentSchema.shape.photos.element
    .extend({ clientFileId: z.string().uuid() })
    .array()
    .max(10)
    .refine((p) => new Set(p.map((f) => f.clientFileId)).size === p.length),
});
async function safe<T>(work: () => Promise<T>) {
  const started = Date.now();
  try {
    return await work();
  } catch (error) {
    const requestId =
      error instanceof ImageOperationError && error.requestId
        ? error.requestId
        : crypto.randomUUID();
    console.warn("document-image.request", {
      requestId,
      stage: "failed",
      code: error instanceof ImageOperationError ? error.code : "unknown",
      elapsedMs: Date.now() - started,
    });
    return {
      error: imageErrorMessage(error) + ` (${requestId.slice(0, 8)})`,
      requestId,
      code: error instanceof ImageOperationError ? error.code : "unknown",
    };
  }
}
export const getDocumentImageFeature = createServerFn({ method: "GET" }).handler(async () => ({
  enabled: readServerEnv().DOCUMENT_IMAGE_UPLOADS_ENABLED === "true",
}));
export const createDocumentText = createServerFn({ method: "POST" })
  .validator(textCreationSchema)
  .handler(async ({ data }) =>
    safe(async () => {
      if (readServerEnv().DOCUMENT_IMAGE_UPLOADS_ENABLED !== "true")
        throw new ImageOperationError("conflict");
      if (!(await consumeIpRateLimit("document-text-create", getRequest(), 30, 10 * 60_000)))
        throw new ImageOperationError("busy", true);
      const result = await createTextDocument(data);
      const queueFailed = await dispatchCreatedDocument(result.documentId);
      return { ...result, queueFailed };
    }),
  );
export const recoverDocumentText = createServerFn({ method: "GET" })
  .validator(z.object({ creationKey: z.string().uuid() }))
  .handler(async ({ data }) => safe(() => recoverCreation(data.creationKey)));
export const getDocumentImageState = createServerFn({ method: "GET" })
  .validator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => safe(() => listDocumentImages(data.documentId)));
export const prepareDocumentImage = createServerFn({ method: "POST" })
  .validator(
    generationSchema.extend({ file: createDocumentSchema.shape.photos.element.optional() }),
  )
  .handler(async ({ data }) =>
    safe(() => issueDocumentImageUrl(data.documentId, data.uploadId, data.generation, data.file)),
  );
export const completeDocumentImage = createServerFn({ method: "POST" })
  .validator(slotSchema.extend({ generation: z.number().int().positive() }))
  .handler(async ({ data }) =>
    safe(() =>
      finalizeDocumentImage(data.documentId, data.uploadId, data.generation, getRequest().signal),
    ),
  );
export const cancelDocumentImageUpload = createServerFn({ method: "POST" })
  .validator(generationSchema)
  .handler(async ({ data }) =>
    safe(() => cancelDocumentImage(data.documentId, data.uploadId, data.generation)),
  );
