import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { richDocumentSchema, projectRichText } from "./rich-text";
import { getRequest } from "@tanstack/react-start/server";

import { directionIdSchema } from "./directions";
import { az } from "./i18n/az";
import { imageMimeFromSignature } from "./briefs";
import { documentIndexingRequested } from "../server/inngest/events";
import { inngest } from "../server/inngest/client";
import { getDb } from "../server/db";
import {
  canManageDocument,
  documentAccessFilter,
  documentManagementFilter,
  getCurrentUser,
} from "../server/db/access";
import { allowedClassifications, canAccessClassification, type Clearance } from "@/server/auth";
import { appUsers, attachments, chunks, documents, documentCreations } from "../server/db/schema";
import { readServerEnv } from "@/server/env";
import { dispatchCreatedDocument } from "@/server/documents/index-dispatch";
import { canonical } from "@/server/documents/creations";
import { imageSessionSchemaExists } from "@/server/storage/cleanup-claims";
import { ImageOperationError, imageErrorMessage } from "@/server/storage/operations";
import { getStorage } from "../server/storage/s3";
import { deleteObjectsBestEffort } from "../server/storage/delete-objects";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";
import { mergeIndexProgress } from "@/server/jobs/index-state";
import { commitImageUploads, newImageUploadKey } from "@/server/storage/image-uploads";
import { attachmentKeys } from "@/server/storage/image-metadata";
import { documentListSchema, listDocumentsPage } from "@/server/documents/queries";

export const listDocuments = createServerFn({ method: "GET" })
  .validator(documentListSchema)
  .handler(async ({ data }) => listDocumentsPage(data));

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
  bodyRich: richDocumentSchema(500_000),
  docDate: documentDateSchema.nullable().optional(),
  direction: directionIdSchema,
  classification: z.enum(["open", "secret", "top_secret", "special"]),
  sourceReliability: z.enum(["A", "B", "C", "D", "E"]),
  infoCredibility: z.number().int().min(1).max(5),
  photos: z.array(imageInputSchema).max(10),
});

const idSchema = z.object({ documentId: z.string().uuid() });
const documentUploadSchema = imageInputSchema.extend({ key: z.string().min(1).max(600) });
const saveDocumentSchema = createDocumentSchema
  .omit({ photos: true })
  .extend({ documentId: z.string().uuid(), uploads: z.array(documentUploadSchema).max(10) });

export const getDocumentFormContext = createServerFn({ method: "GET" }).handler(async () => {
  return {
    classifications: allowedClassifications(getCurrentUser()),
    textFirst: readServerEnv().DOCUMENT_IMAGE_UPLOADS_ENABLED === "true",
    actorId: getCurrentUser().id,
  };
});

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

async function queueDocumentIndexing(documentId: string): Promise<boolean> {
  const db = getDb();
  const [queued] = await db
    .update(documents)
    .set({
      status: "queued",
      step: "queued",
      error: null,
      updatedAt: new Date(),
      progress: mergeIndexProgress(documents.progress, {
        percent: 0,
        leaseId: null,
        recoveryAttempts: 0,
        recoveryExhausted: false,
      }),
    })
    .where(
      and(
        eq(documents.id, documentId),
        documentManagementFilter(),
        inArray(documents.status, ["queued", "failed"]),
      ),
    )
    .returning({ id: documents.id });
  if (!queued) throw new Error(az.documents.form.retryOnlyFailed);
  try {
    if (await dispatchCreatedDocument(documentId, false))
      throw new Error("Index event delivery unavailable");
    return false;
  } catch {
    await db
      .update(documents)
      .set({
        error: az.documents.form.queueFailed,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.status, "queued"),
          documentManagementFilter(),
        ),
      );
    return true;
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
    .where(documentAccessFilter())
    .orderBy(desc(documents.createdAt))
    .limit(8);
  return rows.map((row) => ({
    ...row,
    progress: serializeDocumentProgress(row.progress),
    createdAt: row.createdAt.toISOString(),
  }));
});

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
    const user = getCurrentUser();
    if (!canAccessClassification(user, data.classification)) {
      throw new Error("Your clearance does not allow this classification.");
    }
    if (!(await consumeIpRateLimit("upload-prepare", getRequest(), 30, 10 * 60_000))) {
      throw new Error(az.analytics.rateLimited);
    }
    const documentId = crypto.randomUUID();
    const photos = data.photos.map((photo) => ({
      attachmentId: crypto.randomUUID(),
      name: safeFileName(photo.name),
      mime: photo.mime,
      size: photo.size,
      key: newImageUploadKey("documents", documentId, user.id, photo.mime),
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
          url: await storage.getSignedUploadUrl(photo.key, photo.mime, photo.size),
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
    const user = getCurrentUser();
    if (!canAccessClassification(user, data.classification)) {
      throw new Error("Your clearance does not allow this classification.");
    }
    const db = getDb();
    const storage = getStorage();
    const recoverSaved = async () => {
      const [saved] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, data.documentId),
            eq(documents.ownerId, user.id),
            documentAccessFilter(user),
          ),
        )
        .limit(1);
      if (!saved) return null;
      if (
        saved.title !== data.title ||
        saved.body !== projectRichText(data.bodyRich).text ||
        canonical(saved.bodyRich) !== canonical(data.bodyRich) ||
        saved.classification !== data.classification ||
        saved.direction !== data.direction ||
        saved.docDate !== (data.docDate || null) ||
        saved.sourceReliability !== data.sourceReliability ||
        saved.infoCredibility !== data.infoCredibility
      )
        throw new Error(imageErrorMessage(new ImageOperationError("conflict")));
      return {
        documentId: saved.id,
        queueFailed: saved.status === "queued" ? await dispatchCreatedDocument(saved.id) : false,
      };
    };
    const replay = await recoverSaved();
    if (replay) return replay;
    const committedUploads = await commitImageUploads(
      storage,
      "documents",
      data.documentId,
      user.id,
      data.uploads,
      { signal: getRequest().signal },
    ).catch((error) => {
      throw new Error(imageErrorMessage(error));
    });
    try {
      await db.transaction(async (transaction) => {
        const [currentUser] = await transaction
          .select({ clearance: appUsers.clearance, active: appUsers.active })
          .from(appUsers)
          .where(eq(appUsers.id, user.id))
          .for("share")
          .limit(1);
        if (
          !currentUser?.active ||
          !canAccessClassification(
            { clearance: currentUser.clearance as Clearance },
            data.classification,
          )
        ) {
          throw new Error("Your clearance does not allow this classification.");
        }
        await transaction.insert(documents).values({
          id: data.documentId,
          title: data.title,
          body: projectRichText(data.bodyRich).text,
          bodyRich: data.bodyRich,
          docDate: data.docDate || null,
          direction: data.direction,
          classification: data.classification,
          ownerId: user.id,
          sourceReliability: data.sourceReliability,
          infoCredibility: data.infoCredibility,
          status: "queued",
          step: "queued",
          progress: { percent: 0, totalChunks: 0, completedChunks: 0 },
        });
        if (data.uploads.length > 0) {
          await transaction.insert(attachments).values(
            committedUploads.map((upload) => ({
              id: crypto.randomUUID(),
              documentId: data.documentId,
              storageKey: upload.key,
              imageMetadata: upload.imageMetadata,
              mime: upload.mime,
              size: upload.size,
              caption: safeFileName(upload.name),
            })),
          );
        }
      });
    } catch (error) {
      // A lost COMMIT ACK is not a rollback. The reference-aware sweep owns cleanup.
      const recovered = await recoverSaved().catch(() => null);
      if (recovered) return recovered;
      throw new Error(imageErrorMessage(new ImageOperationError("unknown", true)));
    }

    const queueFailed = await queueDocumentIndexing(data.documentId);
    return { documentId: data.documentId, queueFailed };
  });

export const retryDocumentIndexing = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [document] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(and(eq(documents.id, data.documentId), documentManagementFilter()))
      .limit(1);
    if (!document) throw new Error(az.documents.missing);
    if (document.status !== "failed") throw new Error(az.documents.form.retryOnlyFailed);
    const queueFailed = await queueDocumentIndexing(data.documentId);
    return { documentId: data.documentId, queueFailed };
  });

export const getDocumentDetails = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const currentUser = getCurrentUser();
    const [document] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, data.documentId), documentAccessFilter()))
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
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .where(and(eq(chunks.documentId, data.documentId), documentAccessFilter(currentUser)))
        .orderBy(asc(chunks.ord)),
      db
        .select({
          id: attachments.id,
          documentId: attachments.documentId,
          storageKey: attachments.storageKey,
          mime: attachments.mime,
          size: attachments.size,
          caption: attachments.caption,
        })
        .from(attachments)
        .innerJoin(documents, eq(attachments.documentId, documents.id))
        .where(and(eq(attachments.documentId, data.documentId), documentAccessFilter(currentUser))),
    ]);
    const [stillAccessible] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, data.documentId), documentAccessFilter(currentUser)))
      .limit(1);
    if (!stillAccessible) return null;
    const photos = documentAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.caption ?? "",
      mime: attachment.mime,
      url: `/api/attachments/document/${data.documentId}/${attachment.id}`,
      originalUrl: `/api/attachments/document/${data.documentId}/${attachment.id}?original=1`,
    }));

    return {
      ...document,
      progress: serializeDocumentProgress(document.progress),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      chunks: documentChunks,
      photos,
      canManage: canManageDocument(currentUser, document.ownerId),
      imageUploadsEnabled:
        readServerEnv().DOCUMENT_IMAGE_UPLOADS_ENABLED === "true" ||
        (await imageSessionSchemaExists()),
    };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const user = getCurrentUser();
    const db = getDb();
    const keys = await db.transaction(async (transaction) => {
      const [document] = await transaction
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, data.documentId), documentManagementFilter(user)))
        .for("update")
        .limit(1);
      if (!document) throw new Error(az.documents.missing);
      // Feature-gated producer requires the additive schema. Receipts are tombstones, not TTL data.
      if (readServerEnv().DOCUMENT_IMAGE_UPLOADS_ENABLED === "true")
        await transaction
          .update(documentCreations)
          .set({ state: "deleted" })
          .where(eq(documentCreations.documentId, data.documentId));
      const files = await transaction
        .select({ storageKey: attachments.storageKey, imageMetadata: attachments.imageMetadata })
        .from(attachments)
        .where(eq(attachments.documentId, data.documentId));
      const [deleted] = await transaction
        .delete(documents)
        .where(and(eq(documents.id, data.documentId), documentManagementFilter(user)))
        .returning({ id: documents.id });
      if (!deleted) throw new Error(az.documents.missing);
      return files.flatMap(attachmentKeys);
    });
    const cleanupIncomplete = await deleteObjectsBestEffort(keys, (key) =>
      getStorage().delete(key),
    );
    return { ok: true, cleanupIncomplete };
  });
