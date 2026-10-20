import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";

import {
  briefIdSchema,
  briefInputSchema,
  briefPhotoMetadataSchema,
  imageMimeFromSignature,
  MAX_BRIEF_PHOTOS,
} from "@/lib/briefs";
import { az } from "@/lib/i18n/az";
import { accessFilter } from "@/server/db/access";
import { getDb } from "@/server/db";
import { briefAttachments, chunks, dailyBriefs } from "@/server/db/schema";
import { briefIndexingRequested } from "@/server/inngest/events";
import { inngest } from "@/server/inngest/client";
import { getStorage } from "@/server/storage/s3";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";
import { getCurrentUser, requireAdmin } from "@/server/auth";

const photoListSchema = z.array(briefPhotoMetadataSchema).max(MAX_BRIEF_PHOTOS);
const idListSchema = z
  .array(briefIdSchema)
  .max(MAX_BRIEF_PHOTOS)
  .refine((ids) => new Set(ids).size === ids.length);

export const prepareBriefUploadsSchema = briefInputSchema.extend({
  briefId: briefIdSchema.optional(),
  keepAttachmentIds: idListSchema,
  photos: photoListSchema,
});

const uploadSchema = briefPhotoMetadataSchema.extend({ key: z.string().min(1).max(600) });

export const saveBriefSchema = briefInputSchema.extend({
  briefId: briefIdSchema,
  isNew: z.boolean(),
  keepAttachmentIds: idListSchema,
  uploads: z.array(uploadSchema).max(MAX_BRIEF_PHOTOS),
});

const discardUploadsSchema = z.object({
  briefId: briefIdSchema,
  keys: z.array(z.string().min(1).max(600)).max(MAX_BRIEF_PHOTOS),
});

export function canEditBrief(user: { id: string; role: "admin" | "user" }, authorId: string) {
  return user.role === "admin" || user.id === authorId;
}

export function canDeleteBrief(user: { role: "admin" | "user" }) {
  return user.role === "admin";
}

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

const extensionForMime = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function validUploadKey(
  briefId: string,
  key: string,
  mime: keyof typeof extensionForMime,
): boolean {
  const suffix = extensionForMime[mime];
  return new RegExp(`^briefs/${briefId}/[0-9a-f-]{36}\\.${suffix}$`, "i").test(key);
}

async function deleteUploadedKeys(keys: string[]): Promise<void> {
  const storage = getStorage();
  await Promise.allSettled(keys.map((key) => storage.delete(key)));
}

export async function prepareBriefUploadUrls(
  input: z.infer<typeof prepareBriefUploadsSchema>,
): Promise<{
  briefId: string;
  isNew: boolean;
  uploads: Array<{
    name: string;
    mime: "image/jpeg" | "image/png" | "image/webp";
    size: number;
    key: string;
    url: string;
  }>;
}> {
  const parsed = prepareBriefUploadsSchema.parse(input);
  if (!(await consumeIpRateLimit("upload-prepare", getRequest(), 30, 10 * 60_000))) {
    throw new Error(az.analytics.rateLimited);
  }
  const db = getDb();
  const briefId = parsed.briefId ?? crypto.randomUUID();
  const isNew = parsed.briefId === undefined;
  let currentAttachments: Array<typeof briefAttachments.$inferSelect> = [];

  if (!isNew) {
    const [brief] = await db
      .select({ id: dailyBriefs.id, authorId: dailyBriefs.authorId })
      .from(dailyBriefs)
      .where(and(eq(dailyBriefs.id, briefId), accessFilter()))
      .limit(1);
    if (!brief) throw new Error(az.briefs.missing);
    const user = getCurrentUser();
    if (!canEditBrief(user, brief.authorId)) throw new Error(az.briefs.missing);
    currentAttachments = await db
      .select()
      .from(briefAttachments)
      .where(eq(briefAttachments.briefId, briefId))
      .orderBy(briefAttachments.ord);
    const available = new Set(currentAttachments.map((file) => file.id));
    if (parsed.keepAttachmentIds.some((id) => !available.has(id)))
      throw new Error(az.briefs.saveFailed);
  } else if (parsed.keepAttachmentIds.length > 0) {
    throw new Error(az.briefs.saveFailed);
  }

  if (parsed.keepAttachmentIds.length + parsed.photos.length > MAX_BRIEF_PHOTOS) {
    throw new Error(az.briefs.validation.tooManyPhotos);
  }
  const storage = getStorage();
  const uploads = await Promise.all(
    parsed.photos.map(async (photo) => {
      const mime = photo.mime as keyof typeof extensionForMime;
      const key = `briefs/${briefId}/${crypto.randomUUID()}.${extensionForMime[mime]}`;
      return {
        name: safeFileName(photo.name),
        mime,
        size: photo.size,
        key,
        url: await storage.getSignedUploadUrl(key, mime, 300),
      };
    }),
  );
  return { briefId, isNew, uploads };
}

async function verifyUploadedPhotos(
  briefId: string,
  uploads: z.infer<typeof uploadSchema>[],
): Promise<void> {
  const storage = getStorage();
  for (const upload of uploads) {
    if (!validUploadKey(briefId, upload.key, upload.mime)) {
      throw new Error(az.briefs.uploadVerifyFailed);
    }
    const [metadata, prefix] = await Promise.all([
      storage.getMetadata(upload.key),
      storage.getPrefix(upload.key, 12),
    ]);
    const actualMime = imageMimeFromSignature(prefix);
    if (
      metadata.size !== upload.size ||
      (metadata.contentType !== undefined && metadata.contentType !== upload.mime) ||
      actualMime !== upload.mime
    ) {
      throw new Error(az.briefs.uploadVerifyFailed);
    }
  }
}

export async function saveBriefRecord(
  input: z.infer<typeof saveBriefSchema>,
): Promise<{ ok: true; briefId: string; queueFailed: boolean; cleanupIncomplete: boolean }> {
  const parsed = saveBriefSchema.parse(input);
  const db = getDb();
  const user = getCurrentUser();
  const uploadedKeys = parsed.uploads.map((upload) => upload.key);

  try {
    await verifyUploadedPhotos(parsed.briefId, parsed.uploads);
    if (parsed.keepAttachmentIds.length + parsed.uploads.length > MAX_BRIEF_PHOTOS) {
      throw new Error(az.briefs.validation.tooManyPhotos);
    }

    const [existingBrief] = parsed.isNew
      ? []
      : await db
          .select()
          .from(dailyBriefs)
          .where(and(eq(dailyBriefs.id, parsed.briefId), accessFilter()))
          .limit(1);
    if (parsed.isNew && existingBrief) throw new Error(az.briefs.saveFailed);
    if (!parsed.isNew && !existingBrief) throw new Error(az.briefs.missing);
    if (!parsed.isNew && !canEditBrief(user, existingBrief!.authorId)) {
      throw new Error(az.briefs.missing);
    }

    const existingAttachments = parsed.isNew
      ? []
      : await db
          .select()
          .from(briefAttachments)
          .where(eq(briefAttachments.briefId, parsed.briefId))
          .orderBy(briefAttachments.ord);
    const attachmentById = new Map(existingAttachments.map((file) => [file.id, file]));
    if (parsed.keepAttachmentIds.some((id) => !attachmentById.has(id))) {
      throw new Error(az.briefs.saveFailed);
    }
    const retained = parsed.keepAttachmentIds.map((id) => attachmentById.get(id)!);
    const removedKeys = existingAttachments
      .filter((file) => !parsed.keepAttachmentIds.includes(file.id))
      .map((file) => file.storageKey);
    const now = new Date();
    await db.transaction(async (transaction) => {
      if (parsed.isNew) {
        await transaction.insert(dailyBriefs).values({
          id: parsed.briefId,
          briefDate: parsed.date,
          title: parsed.title,
          body: parsed.body,
          status: "published",
          authorId: user.id,
          updatedBy: user.id,
          indexStatus: "queued",
          indexProgress: { percent: 0, totalChunks: 0, completedChunks: 0 },
          publishedAt: now,
          updatedAt: now,
        });
      } else {
        await transaction
          .update(dailyBriefs)
          .set({
            briefDate: parsed.date,
            title: parsed.title,
            body: parsed.body,
            updatedBy: user.id,
            status: "published",
            indexStatus: "queued",
            indexProgress: { percent: 0, totalChunks: 0, completedChunks: 0 },
            publishedAt: existingBrief!.publishedAt ?? now,
            updatedAt: now,
          })
          .where(and(eq(dailyBriefs.id, parsed.briefId), accessFilter()));
      }

      await transaction.delete(chunks).where(eq(chunks.briefId, parsed.briefId));
      await transaction
        .delete(briefAttachments)
        .where(eq(briefAttachments.briefId, parsed.briefId));
      const finalAttachments = [
        ...retained.map((file, ord) => ({
          id: file.id,
          briefId: parsed.briefId,
          storageKey: file.storageKey,
          name: file.name,
          mime: file.mime,
          size: file.size,
          ord,
        })),
        ...parsed.uploads.map((file, index) => ({
          briefId: parsed.briefId,
          storageKey: file.key,
          name: safeFileName(file.name),
          mime: file.mime,
          size: file.size,
          ord: retained.length + index,
        })),
      ];
      if (finalAttachments.length > 0)
        await transaction.insert(briefAttachments).values(finalAttachments);
    });

    let cleanupIncomplete = false;
    if (removedKeys.length > 0) {
      const results = await Promise.allSettled(removedKeys.map((key) => getStorage().delete(key)));
      cleanupIncomplete = results.some((result) => result.status === "rejected");
    }

    let queueFailed = false;
    try {
      await inngest.send(briefIndexingRequested.create({ briefId: parsed.briefId }));
    } catch {
      queueFailed = true;
      await db
        .update(dailyBriefs)
        .set({ indexStatus: "failed", updatedAt: new Date() })
        .where(and(eq(dailyBriefs.id, parsed.briefId), accessFilter()));
    }
    return { ok: true, briefId: parsed.briefId, queueFailed, cleanupIncomplete };
  } catch (error) {
    if (uploadedKeys.length > 0) await deleteUploadedKeys(uploadedKeys);
    throw error;
  }
}

export async function discardBriefUploads(
  input: z.infer<typeof discardUploadsSchema>,
): Promise<void> {
  const parsed = discardUploadsSchema.parse(input);
  const prefix = `briefs/${parsed.briefId}/`;
  if (parsed.keys.some((key) => !key.startsWith(prefix))) throw new Error(az.briefs.saveFailed);
  await deleteUploadedKeys(parsed.keys);
}

export async function removeBrief(briefId: string): Promise<void> {
  if (!canDeleteBrief(requireAdmin())) throw new Error(az.briefs.missing);
  const db = getDb();
  const files = await db
    .select({ storageKey: briefAttachments.storageKey })
    .from(briefAttachments)
    .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
    .where(and(eq(dailyBriefs.id, briefId), accessFilter()));
  const [brief] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.id, briefId), accessFilter()))
    .limit(1);
  if (!brief) throw new Error(az.briefs.missing);
  await Promise.all(files.map((file) => getStorage().delete(file.storageKey)));
  await db.delete(dailyBriefs).where(and(eq(dailyBriefs.id, briefId), accessFilter()));
}
