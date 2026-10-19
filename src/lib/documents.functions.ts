import { and, asc, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";

import { directionIdSchema } from "./directions";
import { az } from "./i18n/az";
import { imageMimeFromSignature } from "./briefs";
import { documentIndexingRequested } from "../server/inngest/events";
import { inngest } from "../server/inngest/client";
import { getDb } from "../server/db";
import { accessFilter } from "../server/db/access";
import { attachments, chunks, documents } from "../server/db/schema";
import { getStorage } from "../server/storage/s3";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const documentDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
const imageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type DocumentProgress = { percent: number; totalChunks: number; completedChunks: number };

function serializeDocumentProgress(value: unknown): DocumentProgress {
  const progress = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    percent: typeof progress["percent"] === "number" ? progress["percent"] : 0,
    totalChunks: typeof progress["totalChunks"] === "number" ? progress["totalChunks"] : 0,
    completedChunks:
      typeof progress["completedChunks"] === "number" ? progress["completedChunks"] : 0,
  };
}

const imageInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(MAX_IMAGE_SIZE),
});

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z
    .string()
    .min(1)
    .max(500_000)
    .refine((value) => value.trim().length > 0),
  docDate: documentDateSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(30),
  direction: directionIdSchema,
  classification: z.enum(["open", "secret", "top_secret", "special"]),
  sourceReliability: z.enum(["A", "B", "C", "D", "E", "F"]),
  infoCredibility: z.number().int().min(1).max(6),
  photos: z.array(imageInputSchema).max(10),
});

const idSchema = z.object({ documentId: z.string().uuid() });
const documentUploadSchema = imageInputSchema.extend({ key: z.string().min(1).max(600) });
const saveDocumentSchema = createDocumentSchema
  .omit({ photos: true })
  .extend({ documentId: z.string().uuid(), uploads: z.array(documentUploadSchema).max(10) });

function safeFileName(value: string): string {
  const name = value
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .slice(0, 255);
  return name || "photo";
}

async function queueDocumentIndexing(documentId: string): Promise<void> {
  const db = getDb();
  try {
    await db
      .update(documents)
      .set({ status: "queued", step: "queued", error: null, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), accessFilter()));
    await inngest.send(documentIndexingRequested.create({ documentId }));
  } catch {
    await db
      .update(documents)
      .set({
        status: "failed",
        step: "failed",
        error: az.documents.form.queueFailed,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), accessFilter()));
    throw new Error(az.documents.form.queueFailed);
  }
}

export const listRecentDocuments = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      step: documents.step,
      progress: documents.progress,
      chunkCount: documents.chunkCount,
      error: documents.error,
      docDate: documents.docDate,
      direction: documents.direction,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(accessFilter())
    .orderBy(desc(documents.createdAt))
    .limit(8);
  return rows.map((row) => ({
    ...row,
    progress: serializeDocumentProgress(row.progress),
    createdAt: row.createdAt.toISOString(),
  }));
});

function validDocumentUploadKey(
  documentId: string,
  key: string,
  mime: keyof typeof imageTypes,
): boolean {
  return new RegExp(`^documents/${documentId}/[0-9a-f-]{36}\\.${imageTypes[mime]}$`, "i").test(key);
}

export function documentUploadMatches(input: {
  expectedMime: keyof typeof imageTypes;
  expectedSize: number;
  actualSize: number;
  actualContentType?: string | undefined;
  signature: Uint8Array;
}): boolean {
  return (
    input.expectedSize > 0 &&
    input.expectedSize <= MAX_IMAGE_SIZE &&
    input.actualSize === input.expectedSize &&
    (input.actualContentType === undefined || input.actualContentType === input.expectedMime) &&
    imageMimeFromSignature(input.signature) === input.expectedMime
  );
}

export const prepareDocumentUploads = createServerFn({ method: "POST" })
  .validator(createDocumentSchema)
  .handler(async ({ data }) => {
    if (!(await consumeIpRateLimit("upload-prepare", getRequest(), 30, 10 * 60_000))) {
      throw new Error(az.analytics.rateLimited);
    }
    const documentId = crypto.randomUUID();
    const photos = data.photos.map((photo) => ({
      attachmentId: crypto.randomUUID(),
      name: safeFileName(photo.name),
      mime: photo.mime,
      size: photo.size,
      key: `documents/${documentId}/${crypto.randomUUID()}.${imageTypes[photo.mime]}`,
    }));

    try {
      const storage = getStorage();
      const uploads = await Promise.all(
        photos.map(async (photo) => ({
          attachmentId: photo.attachmentId,
          name: photo.name,
          mime: photo.mime,
          size: photo.size,
          key: photo.key,
          url: await storage.getSignedUploadUrl(photo.key, photo.mime),
        })),
      );
      return { documentId, uploads };
    } catch {
      throw new Error(az.documents.form.uploadPrepareFailed);
    }
  });

export const saveDocument = createServerFn({ method: "POST" })
  .validator(saveDocumentSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const storage = getStorage();
    try {
      for (const upload of data.uploads) {
        if (!validDocumentUploadKey(data.documentId, upload.key, upload.mime)) {
          throw new Error(az.documents.form.uploadMetadataMismatch);
        }
        const [metadata, signature] = await Promise.all([
          storage.getMetadata(upload.key),
          storage.getPrefix(upload.key, 12),
        ]);
        if (
          !documentUploadMatches({
            expectedMime: upload.mime,
            expectedSize: upload.size,
            actualSize: metadata.size,
            actualContentType: metadata.contentType,
            signature,
          })
        ) {
          throw new Error(az.documents.form.uploadMetadataMismatch);
        }
      }
    } catch {
      throw new Error(az.documents.form.uploadMetadataMismatch);
    }

    await db.transaction(async (transaction) => {
      await transaction.insert(documents).values({
        id: data.documentId,
        title: data.title,
        body: data.body,
        docDate: data.docDate || null,
        tags: [...new Set(data.tags.map((tag) => tag.trim()).filter(Boolean))],
        direction: data.direction,
        classification: data.classification,
        sourceReliability: data.sourceReliability,
        infoCredibility: data.infoCredibility,
        status: "queued",
        step: "queued",
        progress: { percent: 0, totalChunks: 0, completedChunks: 0 },
      });
      if (data.uploads.length > 0) {
        await transaction.insert(attachments).values(
          data.uploads.map((upload) => ({
            id: crypto.randomUUID(),
            documentId: data.documentId,
            storageKey: upload.key,
            mime: upload.mime,
            size: upload.size,
            caption: safeFileName(upload.name),
          })),
        );
      }
    });

    await queueDocumentIndexing(data.documentId);
    return { documentId: data.documentId };
  });

export const retryDocumentIndexing = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [document] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(and(eq(documents.id, data.documentId), accessFilter()))
      .limit(1);
    if (!document) throw new Error(az.documents.missing);
    if (document.status !== "failed") throw new Error(az.documents.form.retryOnlyFailed);
    await queueDocumentIndexing(data.documentId);
    return { documentId: data.documentId };
  });

export const updateDocumentDirection = createServerFn({ method: "POST" })
  .validator(z.object({ documentId: z.string().uuid(), direction: directionIdSchema }))
  .handler(async ({ data }) => {
    const db = getDb();
    const [document] = await db
      .update(documents)
      .set({ direction: data.direction, updatedAt: new Date() })
      .where(and(eq(documents.id, data.documentId), accessFilter()))
      .returning({ id: documents.id });
    if (!document) throw new Error(az.documents.missing);
    return { documentId: document.id, direction: data.direction };
  });

export const getDocumentDetails = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [document] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, data.documentId), accessFilter()))
      .limit(1);
    if (!document) return null;

    const [documentChunks, documentAttachments] = await Promise.all([
      db
        .select({
          id: chunks.id,
          ord: chunks.ord,
          sectionTitle: chunks.sectionTitle,
          text: chunks.text,
          charStart: chunks.charStart,
          charEnd: chunks.charEnd,
          isTable: chunks.isTable,
        })
        .from(chunks)
        .where(eq(chunks.documentId, data.documentId))
        .orderBy(asc(chunks.ord)),
      db.select().from(attachments).where(eq(attachments.documentId, data.documentId)),
    ]);
    const storage = getStorage();
    const photos = await Promise.all(
      documentAttachments.map(async (attachment) => ({
        id: attachment.id,
        name: attachment.caption ?? "",
        mime: attachment.mime,
        url: await storage.getSignedUrl(attachment.storageKey),
      })),
    );

    return {
      ...document,
      progress: serializeDocumentProgress(document.progress),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      chunks: documentChunks,
      photos,
    };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, data.documentId), accessFilter()))
      .limit(1);
    if (!document) throw new Error(az.documents.missing);

    const files = await db
      .select({ storageKey: attachments.storageKey })
      .from(attachments)
      .where(eq(attachments.documentId, data.documentId));
    await Promise.all(files.map((file) => getStorage().delete(file.storageKey)));
    await db.delete(documents).where(and(eq(documents.id, data.documentId), accessFilter()));
    return { ok: true };
  });
