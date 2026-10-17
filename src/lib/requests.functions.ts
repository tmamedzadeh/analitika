import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";

import { getCurrentUser, accessFilter } from "../server/db/access";
import { getDb } from "../server/db";
import { documents, infoRequests, requestAttachments } from "../server/db/schema";
import { getStorage } from "../server/storage/s3";
import { az } from "./i18n/az";
import {
  infoRequestInputSchema,
  requestAnswerDocumentInputSchema,
  requestIdSchema,
  requestStatusInputSchema,
} from "./requests";

function safeFileName(value: string): string {
  const name = value
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .slice(0, 255);
  return name || "attachment";
}

function requestForCurrentUser(requestId: string) {
  return and(eq(infoRequests.id, requestId), eq(infoRequests.requesterId, getCurrentUser().id));
}

export const listInfoRequests = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const rows = await db
    .select({
      id: infoRequests.id,
      department: infoRequests.department,
      requestDate: infoRequests.requestDate,
      urgency: infoRequests.urgency,
      purpose: infoRequests.purpose,
      details: infoRequests.details,
      sourceReliability: infoRequests.sourceReliability,
      infoCredibility: infoRequests.infoCredibility,
      status: infoRequests.status,
      answerDocumentId: infoRequests.answerDocumentId,
      answerDocumentTitle: documents.title,
      createdAt: infoRequests.createdAt,
      updatedAt: infoRequests.updatedAt,
    })
    .from(infoRequests)
    .leftJoin(documents, and(eq(infoRequests.answerDocumentId, documents.id), accessFilter()))
    .where(eq(infoRequests.requesterId, getCurrentUser().id))
    .orderBy(desc(infoRequests.requestDate), desc(infoRequests.createdAt))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
});

export const listAnswerDocuments = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  return db
    .select({ id: documents.id, title: documents.title, docDate: documents.docDate })
    .from(documents)
    .where(and(eq(documents.status, "ready"), accessFilter()))
    .orderBy(desc(documents.createdAt))
    .limit(500);
});

export const getInfoRequestDetails = createServerFn({ method: "GET" })
  .validator(requestIdSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [request] = await db
      .select({
        id: infoRequests.id,
        department: infoRequests.department,
        requestDate: infoRequests.requestDate,
        urgency: infoRequests.urgency,
        purpose: infoRequests.purpose,
        details: infoRequests.details,
        sourceReliability: infoRequests.sourceReliability,
        infoCredibility: infoRequests.infoCredibility,
        note: infoRequests.note,
        status: infoRequests.status,
        answerDocumentId: infoRequests.answerDocumentId,
        answerDocumentTitle: documents.title,
        createdAt: infoRequests.createdAt,
        updatedAt: infoRequests.updatedAt,
      })
      .from(infoRequests)
      .leftJoin(documents, and(eq(infoRequests.answerDocumentId, documents.id), accessFilter()))
      .where(requestForCurrentUser(data.requestId))
      .limit(1);
    if (!request) return null;

    const files = await db
      .select({
        id: requestAttachments.id,
        name: requestAttachments.name,
        mime: requestAttachments.mime,
        size: requestAttachments.size,
        storageKey: requestAttachments.storageKey,
      })
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, data.requestId));
    const storage = getStorage();
    const attachments = await Promise.all(
      files.map(async ({ storageKey, ...file }) => ({
        ...file,
        url: await storage.getSignedUrl(storageKey),
      })),
    );

    return {
      ...request,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      attachments,
    };
  });

export const createInfoRequestDraft = createServerFn({ method: "POST" })
  .validator(infoRequestInputSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const requestId = crypto.randomUUID();
    const files = data.attachments.map((file) => {
      const extension = file.name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
      return {
        id: crypto.randomUUID(),
        name: safeFileName(file.name),
        mime: file.mime,
        size: file.size,
        storageKey: `requests/${requestId}/${crypto.randomUUID()}.${extension}`,
      };
    });

    await db.transaction(async (transaction) => {
      await transaction.insert(infoRequests).values({
        id: requestId,
        department: data.department,
        requestDate: data.requestDate,
        urgency: data.urgency,
        purpose: data.purpose,
        details: data.details,
        sourceReliability: data.sourceReliability,
        infoCredibility: data.infoCredibility,
        note: data.note,
        requesterId: getCurrentUser().id,
      });
      if (files.length > 0) {
        await transaction.insert(requestAttachments).values(
          files.map((file) => ({
            id: file.id,
            requestId,
            storageKey: file.storageKey,
            name: file.name,
            mime: file.mime,
            size: file.size,
          })),
        );
      }
    });

    try {
      const storage = getStorage();
      const uploads = await Promise.all(
        files.map(async (file) => ({
          attachmentId: file.id,
          url: await storage.getSignedUploadUrl(file.storageKey, file.mime),
          mime: file.mime,
        })),
      );
      return { requestId, uploads };
    } catch {
      await db.delete(infoRequests).where(requestForCurrentUser(requestId));
      throw new Error(az.requests.form.uploadPrepareFailed);
    }
  });

export const completeInfoRequestUploads = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [request] = await db
      .select({ id: infoRequests.id })
      .from(infoRequests)
      .where(requestForCurrentUser(data.requestId))
      .limit(1);
    if (!request) throw new Error(az.requests.missing);

    const files = await db
      .select({
        storageKey: requestAttachments.storageKey,
        mime: requestAttachments.mime,
        size: requestAttachments.size,
      })
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, data.requestId));
    const storage = getStorage();
    try {
      const metadata = await Promise.all(
        files.map(async (file) => ({
          file,
          metadata: await storage.getMetadata(file.storageKey),
        })),
      );
      if (
        metadata.some(
          ({ file, metadata: stored }) =>
            file.size !== stored.size ||
            (stored.contentType !== undefined && file.mime !== stored.contentType),
        )
      ) {
        throw new Error(az.requests.form.uploadMetadataMismatch);
      }
    } catch (error) {
      if (error instanceof Error && error.message === az.requests.form.uploadMetadataMismatch)
        throw error;
      throw new Error(az.requests.form.uploadIncomplete);
    }
    return { requestId: data.requestId };
  });

export const discardInfoRequestDraft = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [request] = await db
      .select({ id: infoRequests.id, status: infoRequests.status })
      .from(infoRequests)
      .where(requestForCurrentUser(data.requestId))
      .limit(1);
    if (!request || request.status !== "new") return { ok: true };

    const files = await db
      .select({ storageKey: requestAttachments.storageKey })
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, data.requestId));
    await Promise.all(files.map((file) => getStorage().delete(file.storageKey)));
    await db.delete(infoRequests).where(requestForCurrentUser(data.requestId));
    return { ok: true };
  });

export const updateInfoRequestStatus = createServerFn({ method: "POST" })
  .validator(requestStatusInputSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [request] = await db
      .update(infoRequests)
      .set({ status: data.status, updatedAt: new Date() })
      .where(requestForCurrentUser(data.requestId))
      .returning({ id: infoRequests.id });
    if (!request) throw new Error(az.requests.missing);
    return { requestId: request.id, status: data.status };
  });

export const setInfoRequestAnswerDocument = createServerFn({ method: "POST" })
  .validator(requestAnswerDocumentInputSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [request] = await db
      .select({ id: infoRequests.id, status: infoRequests.status })
      .from(infoRequests)
      .where(requestForCurrentUser(data.requestId))
      .limit(1);
    if (!request) throw new Error(az.requests.missing);

    if (data.answerDocumentId) {
      const [answerDocument] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, data.answerDocumentId),
            eq(documents.status, "ready"),
            accessFilter(),
          ),
        )
        .limit(1);
      if (!answerDocument) throw new Error(az.requests.answerDocumentMissing);
    }

    const status = data.answerDocumentId
      ? "answered"
      : request.status === "answered"
        ? "in_progress"
        : request.status;
    await db
      .update(infoRequests)
      .set({ answerDocumentId: data.answerDocumentId, status, updatedAt: new Date() })
      .where(requestForCurrentUser(data.requestId));
    return { requestId: data.requestId, answerDocumentId: data.answerDocumentId, status };
  });

export const deleteInfoRequest = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const files = await db
      .select({ storageKey: requestAttachments.storageKey })
      .from(requestAttachments)
      .innerJoin(infoRequests, eq(requestAttachments.requestId, infoRequests.id))
      .where(requestForCurrentUser(data.requestId));
    await Promise.all(files.map((file) => getStorage().delete(file.storageKey)));
    const [deleted] = await db
      .delete(infoRequests)
      .where(requestForCurrentUser(data.requestId))
      .returning({ id: infoRequests.id });
    if (!deleted) throw new Error(az.requests.missing);
    return { ok: true };
  });
