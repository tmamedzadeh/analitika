import { and, asc, count, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { departmentIdSchema } from "./departments";
import { az } from "./i18n/az";
import { documentIndexingRequested } from "../server/inngest/events";
import { inngest } from "../server/inngest/client";
import { getDb } from "../server/db";
import { accessFilter } from "../server/db/access";
import { attachments, chunks, documents } from "../server/db/schema";
import { getStorage } from "../server/storage/s3";

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
  department: departmentIdSchema,
  classification: z.enum(["open", "secret", "top_secret", "special"]),
  sourceReliability: z.enum(["A", "B", "C", "D", "E", "F"]),
  infoCredibility: z.number().int().min(1).max(6),
  photos: z.array(imageInputSchema).max(10),
});

const idSchema = z.object({ documentId: z.string().uuid() });

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
    await inngest.send(documentIndexingRequested.create({ data: { documentId } }));
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
      error: documents.error,
      docDate: documents.docDate,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(accessFilter())
    .orderBy(desc(documents.createdAt))
    .limit(8);
  const counts = await db
    .select({ documentId: chunks.documentId, total: count() })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(accessFilter())
    .groupBy(chunks.documentId);
  const countByDocument = new Map(counts.map((row) => [row.documentId, Number(row.total)]));

  return rows.map((row) => ({
    ...row,
    chunkCount: countByDocument.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
  }));
});

export const createDocumentDraft = createServerFn({ method: "POST" })
  .validator(createDocumentSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const documentId = crypto.randomUUID();
    const photos = data.photos.map((photo) => ({
      id: crypto.randomUUID(),
      name: safeFileName(photo.name),
      mime: photo.mime,
      size: photo.size,
      key: `documents/${documentId}/${crypto.randomUUID()}.${imageTypes[photo.mime]}`,
    }));

    await db.transaction(async (transaction) => {
      await transaction.insert(documents).values({
        id: documentId,
        title: data.title,
        body: data.body,
        docDate: data.docDate || null,
        tags: [...new Set(data.tags.map((tag) => tag.trim()).filter(Boolean))],
        department: data.department,
        classification: data.classification,
        sourceReliability: data.sourceReliability,
        infoCredibility: data.infoCredibility,
        status: "queued",
        step: "queued",
        progress: { percent: 0, totalChunks: 0, completedChunks: 0 },
      });

      if (photos.length > 0) {
        await transaction.insert(attachments).values(
          photos.map((photo) => ({
            id: photo.id,
            documentId,
            storageKey: photo.key,
            mime: photo.mime,
            size: photo.size,
            caption: photo.name,
          })),
        );
      }
    });

    try {
      const storage = getStorage();
      const uploads = await Promise.all(
        photos.map(async (photo) => ({
          attachmentId: photo.id,
          url: await storage.getSignedUploadUrl(photo.key, photo.mime),
        })),
      );
      return { documentId, uploads };
    } catch {
      await db.delete(documents).where(eq(documents.id, documentId));
      throw new Error(az.documents.form.uploadPrepareFailed);
    }
  });

export const completeDocumentUploads = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [document] = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(and(eq(documents.id, data.documentId), accessFilter()))
      .limit(1);
    if (!document) throw new Error(az.documents.missing);
    if (document.status === "ready") return { documentId: data.documentId };

    const documentAttachments = await db
      .select()
      .from(attachments)
      .where(eq(attachments.documentId, data.documentId));
    const storage = getStorage();
    let objects: Array<{
      attachment: (typeof documentAttachments)[number];
      metadata: Awaited<ReturnType<typeof storage.getMetadata>>;
    }>;
    try {
      objects = await Promise.all(
        documentAttachments.map(async (attachment) => ({
          attachment,
          metadata: await storage.getMetadata(attachment.storageKey),
        })),
      );
    } catch {
      throw new Error(az.documents.form.uploadIncomplete);
    }
    if (
      objects.some(
        ({ attachment, metadata }) =>
          metadata.size !== attachment.size ||
          (metadata.contentType !== undefined && metadata.contentType !== attachment.mime),
      )
    ) {
      throw new Error(az.documents.form.uploadMetadataMismatch);
    }

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

export const discardDocumentDraft = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const draft = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, data.documentId),
          eq(documents.status, "queued"),
          eq(documents.step, "queued"),
          accessFilter(),
        ),
      )
      .limit(1);
    if (draft.length === 0) return { ok: true };

    const files = await db
      .select({ storageKey: attachments.storageKey })
      .from(attachments)
      .where(eq(attachments.documentId, data.documentId));
    await Promise.all(files.map((file) => getStorage().delete(file.storageKey)));
    await db.delete(documents).where(and(eq(documents.id, data.documentId), accessFilter()));
    return { ok: true };
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
