import { createHash } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { createDocumentSchema } from "@/lib/documents.functions";
import { projectRichText } from "@/lib/rich-text";
import { getDb } from "../db";
import {
  appUsers,
  documents,
  documentCreations,
  documentImageUploads,
  imageUploadObjects,
} from "../db/schema";
import { canAccessClassification, getCurrentUser } from "../auth";
import { documentAccessFilter } from "../db/access";
import { readServerEnv } from "../env";
import { newImageUploadKey } from "../storage/image-uploads";
import { ImageOperationError } from "../storage/operations";

export type TextCreation = Omit<z.infer<typeof createDocumentSchema>, "photos"> & {
  creationKey: string;
  photos: Array<{
    clientFileId: string;
    name: string;
    mime: "image/jpeg" | "image/png" | "image/webp";
    size: number;
  }>;
};
export type DocumentTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function lockDocumentActor(tx: DocumentTransaction) {
  const actor = getCurrentUser();
  await tx.execute(sql`set local statement_timeout = '5s'`);
  await tx.execute(sql`set local lock_timeout = '1500ms'`);
  const [live] = await tx
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, actor.id))
    .for("update")
    .limit(1);
  if (!live?.active) throw new ImageOperationError("conflict");
  return live;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export async function recoverCreation(creationKey: string, payloadHash?: string) {
  const user = getCurrentUser();
  const db = getDb();
  const [receipt] = await db
    .select()
    .from(documentCreations)
    .where(
      and(eq(documentCreations.actorId, user.id), eq(documentCreations.creationKey, creationKey)),
    )
    .limit(1);
  if (!receipt) return null;
  if (receipt.state !== "saved" || (payloadHash && receipt.payloadHash !== payloadHash))
    throw new ImageOperationError("conflict");
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, receipt.documentId), documentAccessFilter(user)))
    .limit(1);
  if (!document) throw new ImageOperationError("conflict");
  return { documentId: document.id };
}

export async function createTextDocument(input: TextCreation) {
  const user = getCurrentUser();
  const db = getDb();
  const payloadHash = createHash("sha256")
    .update(canonical({ ...input, docDate: input.docDate || null }))
    .digest("hex");
  const recovered = await recoverCreation(input.creationKey, payloadHash);
  if (recovered) return { ...recovered, replay: true };
  const config = readServerEnv();
  const expiresAt = new Date(Date.now() + config.IMAGE_UPLOAD_RETENTION_HOURS * 3600_000);
  try {
    return await db.transaction(async (tx) => {
      const live = await lockDocumentActor(tx);
      if (
        !canAccessClassification(
          live as Parameters<typeof canAccessClassification>[0],
          input.classification,
        )
      )
        throw new ImageOperationError("conflict");
      const [prior] = await tx
        .select()
        .from(documentCreations)
        .where(
          and(
            eq(documentCreations.actorId, user.id),
            eq(documentCreations.creationKey, input.creationKey),
          ),
        )
        .limit(1);
      if (prior) {
        if (prior.payloadHash !== payloadHash || prior.state !== "saved")
          throw new ImageOperationError("conflict");
        return { documentId: prior.documentId, replay: true };
      }
      const pending = await tx
        .select({ size: documentImageUploads.size })
        .from(documentImageUploads)
        .where(
          and(
            eq(documentImageUploads.uploaderId, user.id),
            gt(documentImageUploads.expiresAt, new Date()),
            inArray(documentImageUploads.state, ["pending", "uploading", "checking", "failed"]),
            sql`coalesce(${documentImageUploads.errorCode}, '') <> 'quota'`,
          ),
        );
      // Photo quota failures must not discard otherwise valid text.
      const quotaExceeded =
        pending.length + input.photos.length > config.IMAGE_UPLOAD_MAX_PENDING_FILES ||
        pending.reduce((sum, p) => sum + p.size, 0) +
          input.photos.reduce((sum, p) => sum + p.size, 0) >
          config.IMAGE_UPLOAD_MAX_PENDING_BYTES;
      const documentId = crypto.randomUUID();
      await tx.insert(documents).values({
        id: documentId,
        ownerId: user.id,
        title: input.title,
        body: projectRichText(input.bodyRich).text,
        bodyRich: input.bodyRich,
        docDate: input.docDate || null,
        direction: input.direction,
        classification: input.classification,
        sourceReliability: input.sourceReliability,
        infoCredibility: input.infoCredibility,
        status: "queued",
        step: "queued",
        progress: { percent: 0, totalChunks: 0, completedChunks: 0 },
      });
      await tx.insert(documentCreations).values({
        id: crypto.randomUUID(),
        actorId: user.id,
        creationKey: input.creationKey,
        documentId,
        payloadHash,
      });
      for (const [ord, photo] of input.photos.entries()) {
        const id = crypto.randomUUID();
        const key = newImageUploadKey("documents", documentId, user.id, photo.mime);
        await tx.insert(documentImageUploads).values({
          id,
          documentId,
          clientFileId: photo.clientFileId,
          uploaderId: user.id,
          ord,
          name: photo.name,
          mime: photo.mime,
          size: photo.size,
          stagingKey: key,
          expiresAt,
          state: quotaExceeded ? "failed" : "pending",
          errorCode: quotaExceeded ? "quota" : null,
        });
        await tx
          .insert(imageUploadObjects)
          .values({ key, uploadId: id, generation: 1, protectUntil: expiresAt });
      }
      return { documentId, replay: false };
    });
  } catch (error) {
    if (error instanceof ImageOperationError) throw error;
    // A separate query can recover a committed result whose ACK was lost.
    try {
      const result = await recoverCreation(input.creationKey, payloadHash);
      if (result) return { ...result, replay: true };
    } catch (recoveryError) {
      if (recoveryError instanceof ImageOperationError) throw recoveryError;
    }
    throw new ImageOperationError("unknown", true);
  }
}
