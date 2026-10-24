import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  attachments,
  documentImageUploads as uploads,
  documents,
  imageUploadObjects as objects,
} from "../db/schema";
import { documentAccessFilter, documentManagementFilter } from "../db/access";
import { getCurrentUser } from "../auth";
import { lockDocumentActor, type DocumentTransaction } from "../documents/creations";
import { getStorage } from "./s3";
import { commitImageUploads, newImageUploadKey } from "./image-uploads";
import { ImageOperationError, operationScope } from "./operations";
import { readServerEnv } from "../env";

async function lockedUpload(tx: DocumentTransaction, documentId: string, uploadId: string) {
  const actor = await lockDocumentActor(tx);
  const [parent] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), documentManagementFilter()))
    .for("update")
    .limit(1);
  if (!parent) throw new ImageOperationError("conflict");
  const [upload] = await tx
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.id, uploadId),
        eq(uploads.documentId, documentId),
        eq(uploads.uploaderId, actor.id),
      ),
    )
    .for("update")
    .limit(1);
  if (!upload) throw new ImageOperationError("conflict");
  return upload;
}

export async function listDocumentImages(documentId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: uploads.id,
      clientFileId: uploads.clientFileId,
      name: uploads.name,
      mime: uploads.mime,
      size: uploads.size,
      generation: uploads.generation,
      state: uploads.state,
      errorCode: uploads.errorCode,
      expiresAt: uploads.expiresAt,
      leaseUntil: uploads.leaseUntil,
      signedUntil: uploads.signedUntil,
    })
    .from(uploads)
    .innerJoin(documents, eq(uploads.documentId, documents.id))
    .where(and(eq(uploads.documentId, documentId), documentAccessFilter()))
    .orderBy(asc(uploads.ord));
  return rows.map(({ leaseUntil, signedUntil, ...row }) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    state:
      !["ready", "cancelled"].includes(row.state) && row.expiresAt < new Date()
        ? "expired"
        : row.state === "checking" && leaseUntil && leaseUntil <= new Date()
          ? "failed"
          : row.state === "uploading" && signedUntil && signedUntil <= new Date()
            ? "pending"
            : row.state,
  }));
}

export async function issueDocumentImageUrl(
  documentId: string,
  uploadId: string,
  expectedGeneration?: number,
  replacement?: { name: string; mime: string; size: number },
) {
  const db = getDb();
  const user = getCurrentUser();
  const upload = await db.transaction(async (tx) => {
    const current = await lockedUpload(tx, documentId, uploadId);
    if (expectedGeneration !== undefined && current.generation !== expectedGeneration)
      throw new ImageOperationError("conflict");
    if (current.state === "ready") return current;
    if (current.leaseUntil && current.leaseUntil > new Date())
      throw new ImageOperationError("busy", true);
    if (current.generation >= 20) throw new ImageOperationError("conflict");
    const desired = replacement ?? current;
    const config = readServerEnv();
    const pending = await tx
      .select({ id: uploads.id, size: uploads.size })
      .from(uploads)
      .where(
        and(
          eq(uploads.uploaderId, user.id),
          sql`${uploads.expiresAt} > now()`,
          inArray(uploads.state, ["pending", "uploading", "checking", "failed"]),
          sql`coalesce(${uploads.errorCode}, '') <> 'quota'`,
        ),
      );
    const reserved = pending.some((p) => p.id === current.id);
    if (
      pending.length + (reserved ? 0 : 1) > config.IMAGE_UPLOAD_MAX_PENDING_FILES ||
      pending.reduce((n, u) => n + u.size, 0) - (reserved ? current.size : 0) + desired.size >
        config.IMAGE_UPLOAD_MAX_PENDING_BYTES
    )
      throw new ImageOperationError("busy", true);
    const generation = current.generation + 1;
    const key = newImageUploadKey("documents", documentId, user.id, desired.mime as "image/png");
    const expiresAt =
      current.expiresAt > new Date()
        ? current.expiresAt
        : new Date(Date.now() + config.IMAGE_UPLOAD_RETENTION_HOURS * 3600_000);
    await tx.insert(objects).values({ key, uploadId, generation, protectUntil: expiresAt });
    const [updated] = await tx
      .update(uploads)
      .set({
        generation,
        name: desired.name,
        mime: desired.mime,
        size: desired.size,
        stagingKey: key,
        state: "uploading",
        leaseId: null,
        leaseUntil: null,
        errorCode: null,
        signedUntil: new Date(Date.now() + 300_000),
        expiresAt,
      })
      .where(eq(uploads.id, uploadId))
      .returning();
    return updated!;
  });
  if (upload.state === "ready") return { state: "ready" as const, generation: upload.generation };
  const url = await getStorage().getSignedUploadUrl(
    upload.stagingKey,
    upload.mime,
    upload.size,
    300,
  );
  return {
    state: "uploading" as const,
    url,
    generation: upload.generation,
    expiresAt: upload.signedUntil!.toISOString(),
  };
}

export async function finalizeDocumentImage(
  documentId: string,
  uploadId: string,
  generation: number,
  signal?: AbortSignal,
) {
  const db = getDb();
  const user = getCurrentUser();
  const leaseId = crypto.randomUUID();
  const upload = await db.transaction(async (tx) => {
    const current = await lockedUpload(tx, documentId, uploadId);
    if (current.generation !== generation) throw new ImageOperationError("conflict");
    if (current.state === "ready") return current;
    if (["cancelled", "expired"].includes(current.state) || current.expiresAt <= new Date())
      throw new ImageOperationError("cancelled");
    if (current.leaseUntil && current.leaseUntil > new Date())
      throw new ImageOperationError("busy", true);
    const [source] = await tx
      .select()
      .from(objects)
      .where(eq(objects.key, current.stagingKey))
      .for("update")
      .limit(1);
    if (!source || source.state === "deleting") throw new ImageOperationError("conflict");
    await tx
      .update(uploads)
      .set({
        state: "checking",
        leaseId,
        leaseUntil: new Date(Date.now() + 60_000),
        errorCode: null,
      })
      .where(eq(uploads.id, uploadId));
    return current;
  });
  if (upload.state === "ready") return { state: "ready" as const };
  const scope = operationScope({ signal }, 45_000);
  const started = Date.now();
  const requestId = crypto.randomUUID();
  try {
    const [committed] = await commitImageUploads(
      getStorage(),
      "documents",
      documentId,
      user.id,
      [{ key: upload.stagingKey, mime: upload.mime as "image/png", size: upload.size }],
      {
        signal: scope.signal,
        requestId,
        beforeWrite: async (key) => {
          await db.transaction(async (tx) => {
            const live = await lockedUpload(tx, documentId, uploadId);
            if (
              live.leaseId !== leaseId ||
              live.generation !== generation ||
              !live.leaseUntil ||
              live.leaseUntil <= new Date() ||
              live.expiresAt <= new Date()
            )
              throw new ImageOperationError("conflict");
            await tx
              .insert(objects)
              .values({ key, uploadId, generation, protectUntil: live.expiresAt });
          });
        },
      },
    );
    scope.signal.throwIfAborted();
    await db.transaction(async (tx) => {
      const live = await lockedUpload(tx, documentId, uploadId);
      if (
        live.generation !== generation ||
        live.leaseId !== leaseId ||
        live.state !== "checking" ||
        !live.leaseUntil ||
        live.leaseUntil <= new Date() ||
        live.expiresAt <= new Date()
      )
        throw new ImageOperationError("conflict");
      const keys = [
        committed!.key,
        ...(committed!.imageMetadata.derivative ? [committed!.imageMetadata.derivative.key] : []),
      ];
      const claimed = await tx
        .select()
        .from(objects)
        .where(inArray(objects.key, keys))
        .for("update");
      if (
        claimed.length !== keys.length ||
        claimed.some(
          (o) => o.state !== "protected" || o.uploadId !== uploadId || o.generation !== generation,
        )
      )
        throw new ImageOperationError("conflict");
      await tx.insert(attachments).values({
        id: uploadId,
        documentId,
        storageKey: committed!.key,
        imageMetadata: committed!.imageMetadata,
        mime: upload.mime,
        size: upload.size,
        caption: upload.name,
      });
      await tx.update(objects).set({ state: "published" }).where(inArray(objects.key, keys));
      await tx
        .update(uploads)
        .set({ state: "ready", leaseId: null, leaseUntil: null, errorCode: null })
        .where(eq(uploads.id, uploadId));
    });
    console.info("image.finalize", {
      requestId,
      stage: "published",
      elapsedMs: Date.now() - started,
      bytes: upload.size,
    });
    return { state: "ready" as const };
  } catch (error) {
    // Never delete candidate objects on SQL/HTTP ACK ambiguity.
    try {
      const current = await listDocumentImages(documentId);
      if (
        current.some((u) => u.id === uploadId && u.state === "ready" && u.generation === generation)
      )
        return { state: "ready" as const };
      const code =
        error instanceof ImageOperationError
          ? error.code
          : scope.signal.aborted
            ? scope.signal.reason instanceof ImageOperationError
              ? scope.signal.reason.code
              : "cancelled"
            : "unknown";
      await db
        .update(uploads)
        .set({ state: "failed", errorCode: code, leaseId: null, leaseUntil: null })
        .where(
          and(
            eq(uploads.id, uploadId),
            eq(uploads.leaseId, leaseId),
            eq(uploads.generation, generation),
          ),
        );
      console.warn("image.finalize", {
        requestId,
        stage: "failed",
        code,
        elapsedMs: Date.now() - started,
      });
      throw new ImageOperationError(code, code !== "validation", requestId);
    } catch (recoveryError) {
      if (recoveryError instanceof ImageOperationError) throw recoveryError;
      throw new ImageOperationError("unknown", true, requestId);
    }
  } finally {
    scope.dispose();
  }
}

export async function cancelDocumentImage(
  documentId: string,
  uploadId: string,
  expectedGeneration?: number,
) {
  await getDb().transaction(async (tx) => {
    const current = await lockedUpload(tx, documentId, uploadId);
    if (expectedGeneration !== undefined && current.generation !== expectedGeneration)
      throw new ImageOperationError("conflict");
    if (current.state === "ready") return;
    await tx
      .update(uploads)
      .set({
        state: "cancelled",
        generation: current.generation + 1,
        leaseId: null,
        leaseUntil: null,
        errorCode: null,
      })
      .where(eq(uploads.id, uploadId));
  });
  return { state: "cancelled" as const };
}
