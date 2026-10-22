import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";

import {
  briefIdSchema,
  briefInputSchema,
  briefPhotoMetadataSchema,
  MAX_BRIEF_PHOTOS,
} from "@/lib/briefs";
import { az } from "@/lib/i18n/az";
import { briefAccessFilter, adminAccessFilter } from "@/server/db/access";
import { getDb } from "@/server/db";
import { appUsers, briefAttachments, dailyBriefs } from "@/server/db/schema";
import { briefIndexingRequested } from "@/server/inngest/events";
import { inngest } from "@/server/inngest/client";
import { getStorage } from "@/server/storage/s3";
import { deleteObjectsBestEffort } from "@/server/storage/delete-objects";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";
import {
  getCurrentUser,
  requireAdmin,
  canAccessClassification,
  clearanceValues,
  type Clearance,
} from "@/server/auth";
import { briefContentHash } from "./index-state";
import { indexProgress } from "../jobs/index-state";
import {
  commitImageUploads,
  discardImageUploads,
  isOwnedImageUploadKey,
  newImageUploadKey,
} from "../storage/image-uploads";

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

export function assertBriefClassificationWrite(
  actor: { role: "admin" | "user"; clearance: string },
  classification: string,
  previous?: string,
) {
  if (
    !canAccessClassification({ clearance: actor.clearance as Clearance }, classification) ||
    (previous !== undefined &&
      !canAccessClassification({ clearance: actor.clearance as Clearance }, previous))
  ) {
    throw new Error(az.briefs.validation.classification);
  }
  // No document declassification policy exists: lowering a brief is admin-only.
  if (
    previous !== undefined &&
    clearanceValues.indexOf(classification as Clearance) <
      clearanceValues.indexOf(previous as Clearance) &&
    actor.role !== "admin"
  ) {
    throw new Error(az.briefs.validation.declassification);
  }
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
  const user = getCurrentUser();
  if (!(await consumeIpRateLimit("upload-prepare", getRequest(), 30, 10 * 60_000))) {
    throw new Error(az.analytics.rateLimited);
  }
  const db = getDb();
  const briefId = parsed.briefId ?? crypto.randomUUID();
  const isNew = parsed.briefId === undefined;
  return db.transaction(async (transaction) => {
    const [actor] = await transaction
      .select({ id: appUsers.id, role: appUsers.role, clearance: appUsers.clearance })
      .from(appUsers)
      .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
      .for("share")
      .limit(1);
    if (!actor) throw new Error(az.briefs.missing);
    assertBriefClassificationWrite(actor, parsed.classification);
    let currentAttachments: Array<typeof briefAttachments.$inferSelect> = [];

    if (!isNew) {
      const [brief] = await transaction
        .select({
          id: dailyBriefs.id,
          authorId: dailyBriefs.authorId,
          classification: dailyBriefs.classification,
        })
        .from(dailyBriefs)
        .where(
          and(
            eq(dailyBriefs.id, briefId),
            briefAccessFilter(),
            sql`(${dailyBriefs.authorId} = ${user.id} or ${adminAccessFilter(user)})`,
          ),
        )
        .for("share")
        .limit(1);
      if (!brief) throw new Error(az.briefs.missing);
      if (!canEditBrief(actor, brief.authorId)) throw new Error(az.briefs.missing);
      assertBriefClassificationWrite(actor, parsed.classification, brief.classification);
      currentAttachments = await transaction
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
        const key = newImageUploadKey("briefs", briefId, user.id, mime);
        return {
          name: safeFileName(photo.name),
          mime,
          size: photo.size,
          key,
          url: await storage.getSignedUploadUrl(key, mime, photo.size, 300),
        };
      }),
    );
    return { briefId, isNew, uploads };
  });
}

export async function saveBriefRecord(
  input: z.infer<typeof saveBriefSchema>,
  options: { sendIndexing?: (briefId: string) => Promise<unknown> } = {},
): Promise<{ ok: true; briefId: string; queueFailed: boolean; cleanupIncomplete: boolean }> {
  const parsed = saveBriefSchema.parse(input);
  const db = getDb();
  const user = getCurrentUser();
  const uploadedKeys = parsed.uploads
    .filter((upload) =>
      isOwnedImageUploadKey("briefs", parsed.briefId, user.id, upload.key, upload.mime),
    )
    .map((upload) => upload.key);

  let committedUploads: z.infer<typeof uploadSchema>[] = [];
  let recordCommitted = false;
  try {
    if (parsed.keepAttachmentIds.length + parsed.uploads.length > MAX_BRIEF_PHOTOS) {
      throw new Error(az.briefs.validation.tooManyPhotos);
    }

    const [existingBrief] = parsed.isNew
      ? []
      : await db
          .select({
            ...getTableColumns(dailyBriefs),
            version: sql<string>`${dailyBriefs.updatedAt}::text`,
          })
          .from(dailyBriefs)
          .where(and(eq(dailyBriefs.id, parsed.briefId), briefAccessFilter()))
          .limit(1);
    if (parsed.isNew && existingBrief) throw new Error(az.briefs.saveFailed);
    if (!parsed.isNew && !existingBrief) throw new Error(az.briefs.missing);
    if (!parsed.isNew && !canEditBrief(user, existingBrief!.authorId)) {
      throw new Error(az.briefs.missing);
    }
    const [currentActor] = await db
      .select({ role: appUsers.role, clearance: appUsers.clearance })
      .from(appUsers)
      .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
      .limit(1);
    if (!currentActor) throw new Error(az.briefs.missing);
    assertBriefClassificationWrite(
      currentActor,
      parsed.classification,
      existingBrief?.classification,
    );
    committedUploads = await commitImageUploads(
      getStorage(),
      "briefs",
      parsed.briefId,
      user.id,
      parsed.uploads,
    ).catch(() => {
      throw new Error(az.briefs.uploadVerifyFailed);
    });
    const needsIndexing =
      !existingBrief ||
      briefContentHash(existingBrief) !==
        briefContentHash({ title: parsed.title, body: parsed.body, briefDate: parsed.date });

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
      const [actor] = await transaction
        .select({ id: appUsers.id, role: appUsers.role, clearance: appUsers.clearance })
        .from(appUsers)
        .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
        .for("share")
        .limit(1);
      if (!actor) throw new Error(az.briefs.missing);
      assertBriefClassificationWrite(actor, parsed.classification);
      if (!parsed.isNew) {
        const [locked] = await transaction
          .select({
            authorId: dailyBriefs.authorId,
            classification: dailyBriefs.classification,
            version: sql<string>`${dailyBriefs.updatedAt}::text`,
          })
          .from(dailyBriefs)
          .where(and(eq(dailyBriefs.id, parsed.briefId), briefAccessFilter()))
          .for("update")
          .limit(1);
        if (
          !locked ||
          !canEditBrief(actor, locked.authorId) ||
          locked.version !== existingBrief!.version
        ) {
          throw new Error(az.briefs.saveFailed);
        }
        assertBriefClassificationWrite(actor, parsed.classification, locked.classification);
      }
      if (parsed.isNew) {
        await transaction.insert(dailyBriefs).values({
          id: parsed.briefId,
          briefDate: parsed.date,
          title: parsed.title,
          body: parsed.body,
          classification: parsed.classification,
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
            classification: parsed.classification,
            updatedBy: user.id,
            status: "published",
            ...(needsIndexing
              ? {
                  indexStatus: "queued",
                  indexProgress: {
                    ...indexProgress(existingBrief!.indexProgress),
                    percent: 0,
                    totalChunks: 0,
                    completedChunks: 0,
                    recoveryAttempts: 0,
                    leaseId: null,
                    ...(existingBrief!.indexStatus === "ready"
                      ? { contentHash: briefContentHash(existingBrief!) }
                      : {}),
                  },
                }
              : {}),
            publishedAt: existingBrief!.publishedAt ?? now,
            updatedAt: now,
          })
          .where(and(eq(dailyBriefs.id, parsed.briefId), briefAccessFilter()));
      }

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
        ...committedUploads.map((file, index) => ({
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

    recordCommitted = true;
    await discardImageUploads(getStorage(), "briefs", parsed.briefId, user.id, uploadedKeys);
    let cleanupIncomplete = false;
    if (removedKeys.length > 0) {
      const results = await Promise.allSettled(removedKeys.map((key) => getStorage().delete(key)));
      cleanupIncomplete = results.some((result) => result.status === "rejected");
    }

    let queueFailed = false;
    try {
      if (needsIndexing)
        await (options.sendIndexing
          ? options.sendIndexing(parsed.briefId)
          : inngest.send(briefIndexingRequested.create({ briefId: parsed.briefId })));
    } catch {
      queueFailed = true;
      await db
        .update(dailyBriefs)
        .set({ indexStatus: "queued", updatedAt: new Date() })
        .where(
          and(
            eq(dailyBriefs.id, parsed.briefId),
            eq(dailyBriefs.indexStatus, "queued"),
            briefAccessFilter(),
          ),
        );
    }
    return { ok: true, briefId: parsed.briefId, queueFailed, cleanupIncomplete };
  } catch (error) {
    if (!recordCommitted)
      await Promise.allSettled(committedUploads.map(({ key }) => getStorage().delete(key)));
    if (uploadedKeys.length > 0)
      await discardImageUploads(getStorage(), "briefs", parsed.briefId, user.id, uploadedKeys);
    throw error;
  }
}

export async function discardBriefUploads(
  input: z.infer<typeof discardUploadsSchema>,
): Promise<void> {
  const parsed = discardUploadsSchema.parse(input);
  await discardImageUploads(
    getStorage(),
    "briefs",
    parsed.briefId,
    getCurrentUser().id,
    parsed.keys,
  );
}

export async function removeBrief(briefId: string): Promise<{ cleanupIncomplete: boolean }> {
  const user = requireAdmin();
  if (!canDeleteBrief(user)) throw new Error(az.briefs.missing);
  const db = getDb();
  const keys = await db.transaction(async (transaction) => {
    const files = await transaction
      .select({ storageKey: briefAttachments.storageKey })
      .from(briefAttachments)
      .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
      .where(and(eq(dailyBriefs.id, briefId), adminAccessFilter(user), briefAccessFilter(user)));
    const [brief] = await transaction
      .delete(dailyBriefs)
      .where(and(eq(dailyBriefs.id, briefId), adminAccessFilter(user), briefAccessFilter(user)))
      .returning({ id: dailyBriefs.id });
    if (!brief) throw new Error(az.briefs.missing);
    return files.map(({ storageKey }) => storageKey);
  });
  const cleanupIncomplete = await deleteObjectsBestEffort(keys, (key) => getStorage().delete(key));
  return { cleanupIncomplete };
}
