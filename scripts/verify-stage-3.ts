import { and, eq, sql } from "drizzle-orm";
import process from "node:process";

import { departments } from "../src/lib/departments";
import { infoRequestInputSchema, requestMimeFromName } from "../src/lib/requests";
import { closeDb, getDb } from "../src/server/db";
import {
  attachments,
  chunks,
  documents,
  infoRequests,
  requestAttachments,
} from "../src/server/db/schema";
import { closeStorage, getStorage } from "../src/server/storage/s3";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pOQAAAAASUVORK5CYII=",
  "base64",
);
const testFileName = "stage3-verification.png";
const testMime = requestMimeFromName(testFileName);
if (!testMime) throw new Error("The synthetic request attachment MIME type is invalid.");

let currentStep = "request schema and migration";
const requestId = crypto.randomUUID();
const documentId = crypto.randomUUID();
const attachmentId = crypto.randomUUID();
const storageKey = `stage-3-check/${requestId}/${testFileName}`;
let uploaded = false;

async function verifyStage3(): Promise<void> {
  const db = getDb();
  const storage = getStorage();
  try {
    const input = infoRequestInputSchema.safeParse({
      department: departments[0].id,
      requestDate: new Date().toISOString().slice(0, 10),
      urgency: "urgent",
      purpose: "Mərhələ 3 sintetik yoxlaması",
      details: "Bu sorğu yalnız avtomatlaşdırılmış yoxlama üçündür.",
      sourceReliability: "B",
      infoCredibility: 2,
      note: "",
      attachments: [{ name: testFileName, mime: testMime, size: pngBytes.length }],
    });
    if (!input.success) throw new Error("The valid request failed client/server Zod validation.");
    const invalidInput = infoRequestInputSchema.safeParse({
      ...input.data,
      requestDate: "not-a-date",
    });
    if (invalidInput.success) throw new Error("The request schema accepted an invalid date.");

    const tableRows = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('info_requests', 'request_attachments')
    `);
    const tables = new Set(tableRows.map((row) => String(row["table_name"])));
    if (!tables.has("info_requests") || !tables.has("request_attachments")) {
      throw new Error("The stage 0 request tables are missing from the database.");
    }

    currentStep = "synthetic request and answer-document persistence";
    await db.transaction(async (transaction) => {
      await transaction.insert(documents).values({
        id: documentId,
        title: "Sintetik cavab sənədi · mərhələ 3 yoxlaması",
        body: "Bu sənəd yalnız sintetik yoxlamadır.",
        status: "ready",
        step: "ready",
        sourceReliability: "B",
        infoCredibility: 2,
      });
      await transaction.insert(infoRequests).values({
        id: requestId,
        department: input.data.department,
        requestDate: input.data.requestDate,
        urgency: input.data.urgency,
        purpose: input.data.purpose,
        details: input.data.details,
        sourceReliability: input.data.sourceReliability,
        infoCredibility: input.data.infoCredibility,
        note: input.data.note,
        requesterId: "admin",
      });
      await transaction.insert(requestAttachments).values({
        id: attachmentId,
        requestId,
        storageKey,
        name: testFileName,
        mime: testMime,
        size: pngBytes.length,
      });
    });

    currentStep = "signed request attachment upload, metadata, and read";
    const uploadUrl = await storage.getSignedUploadUrl(storageKey, testMime);
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": testMime },
      body: pngBytes,
    });
    if (!upload.ok) throw new Error("Storage rejected the synthetic request file upload.");
    uploaded = true;
    const metadata = await storage.getMetadata(storageKey);
    if (metadata.size !== pngBytes.length || metadata.contentType !== testMime) {
      throw new Error("The request attachment metadata did not match the upload.");
    }
    const signedUrl = await storage.getSignedUrl(storageKey);
    const read = await fetch(signedUrl);
    const bytes = new Uint8Array(await read.arrayBuffer());
    if (!read.ok || bytes.length !== pngBytes.length) {
      throw new Error("The request attachment could not be read through its signed URL.");
    }

    currentStep = "request list, details, and separate attachment isolation";
    const visibleRequests = await db
      .select({ id: infoRequests.id, details: infoRequests.details, name: requestAttachments.name })
      .from(infoRequests)
      .innerJoin(requestAttachments, eq(requestAttachments.requestId, infoRequests.id))
      .where(and(eq(infoRequests.id, requestId), eq(infoRequests.requesterId, "admin")));
    if (visibleRequests.length !== 1 || visibleRequests[0]?.name !== testFileName) {
      throw new Error("The request and attachment were not visible together in the request list.");
    }
    const documentAttachments = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.documentId, documentId));
    const indexedChunks = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId));
    if (documentAttachments.length > 0 || indexedChunks.length > 0) {
      throw new Error("The request attachment entered the document or analytics index.");
    }

    currentStep = "status update and answer-document binding";
    await db
      .update(infoRequests)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(infoRequests.id, requestId));
    await db
      .update(infoRequests)
      .set({ status: "answered", answerDocumentId: documentId, updatedAt: new Date() })
      .where(eq(infoRequests.id, requestId));
    const [linkedRequest] = await db
      .select({
        status: infoRequests.status,
        answerDocumentId: infoRequests.answerDocumentId,
        title: documents.title,
      })
      .from(infoRequests)
      .leftJoin(documents, eq(infoRequests.answerDocumentId, documents.id))
      .where(eq(infoRequests.id, requestId))
      .limit(1);
    if (
      linkedRequest?.status !== "answered" ||
      linkedRequest.answerDocumentId !== documentId ||
      !linkedRequest.title
    ) {
      throw new Error("The request status or answer-document link was not saved.");
    }

    currentStep = "request deletion and attachment cleanup";
    await storage.delete(storageKey);
    uploaded = false;
    await db.delete(infoRequests).where(eq(infoRequests.id, requestId));
    const [remainingRequest] = await db
      .select({ id: infoRequests.id })
      .from(infoRequests)
      .where(eq(infoRequests.id, requestId));
    const remainingAttachments = await db
      .select({ id: requestAttachments.id })
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, requestId));
    if (remainingRequest || remainingAttachments.length > 0) {
      throw new Error("The request or its attachment record remained after deletion.");
    }
    let objectRemoved = false;
    try {
      await storage.getMetadata(storageKey);
    } catch (error) {
      const storageError = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
        statusCode?: number;
      };
      objectRemoved =
        storageError.$metadata?.httpStatusCode === 404 ||
        storageError.statusCode === 404 ||
        storageError.name === "NotFound" ||
        storageError.name === "NoSuchKey";
      if (!objectRemoved) throw error;
    }
    if (!objectRemoved) {
      throw new Error("The request attachment remained in private Storage after deletion.");
    }
    console.log(
      "Synthetic request, private attachment, signed read, status update, answer link, and deletion all passed.",
    );
  } finally {
    if (uploaded) await storage.delete(storageKey).catch(() => undefined);
    await db
      .delete(infoRequests)
      .where(eq(infoRequests.id, requestId))
      .catch(() => undefined);
    await db
      .delete(documents)
      .where(eq(documents.id, documentId))
      .catch(() => undefined);
    closeStorage();
    await closeDb();
  }
}

verifyStage3().catch((error: unknown) => {
  const metadata =
    error instanceof Error
      ? (error as Error & { code?: unknown; status?: unknown; statusCode?: unknown })
      : undefined;
  const descriptor = [
    metadata?.name ?? "UnknownError",
    typeof metadata?.code === "string" ? `code=${metadata.code}` : "",
    typeof metadata?.status === "number" ? `status=${metadata.status}` : "",
    typeof metadata?.statusCode === "number" ? `statusCode=${metadata.statusCode}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const failure = error instanceof Error ? (error as Error & { cause?: unknown }) : undefined;
  let reason = failure?.message ?? "Unknown failure";
  if (failure?.cause instanceof Error) reason += `; cause: ${failure.cause.message}`;
  for (const secretName of ["DATABASE_URL", "DATABASE_URL_MIGRATE", "S3_SECRET_ACCESS_KEY"]) {
    const secret = process.env[secretName];
    if (secret) reason = reason.replaceAll(secret, "[redacted]");
  }
  reason = reason
    .replace(/(?:postgres|postgresql):\/\/[^\s]+/gi, "[redacted database URL]")
    .slice(0, 240);
  console.error(`Stage 3 verification failed during ${currentStep} (${descriptor}): ${reason}`);
  process.exitCode = 1;
});
