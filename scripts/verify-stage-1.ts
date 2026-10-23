import { plainTextDocument } from "../src/lib/rich-text";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import process from "node:process";

import { createGeminiProviders } from "../src/server/ai/gemini";
import { withProjectEvaluationUser } from "../src/server/evaluation-safety";
import { getCurrentUser } from "../src/server/auth";
import { closeDb, getDb } from "../src/server/db";
import { attachments, chunks, documents } from "../src/server/db/schema";
import { processDocumentJob } from "../src/server/jobs/process-document";
import { closeStorage, getStorage } from "../src/server/storage/s3";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pOQAAAAASUVORK5CYII=",
  "base64",
);
const testBody = [
  "# Sintetik mərhələ 1 yoxlaması",
  "Bu mətn yalnız avtomatlaşdırılmış yoxlama üçündür.",
  "",
  "## Nəticələr",
  "| Ölçü | Dəyər |",
  "| --- | --- |",
  "| Sınaq | Uğurlu |",
  "| Şəkillər | İki fayl |",
].join("\n");

let currentStep = "synthetic document setup";
let documentId: string | undefined;
const objectKeys: string[] = [];

async function verifyStage1(): Promise<void> {
  const db = getDb();
  const ownerId = await withProjectEvaluationUser(() => getCurrentUser().id);
  const storage = getStorage();
  const createdId = crypto.randomUUID();
  const photos = [1, 2].map((index) => ({
    id: crypto.randomUUID(),
    key: `stage-1-check/${createdId}/${index}.png`,
  }));

  try {
    currentStep = "stage 1 database columns";
    const columnRows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents'
        AND column_name IN ('step', 'progress')
    `);
    const documentColumns = new Set(columnRows.map((row) => String(row["column_name"])));
    if (!documentColumns.has("step") || !documentColumns.has("progress")) {
      throw new Error("The stage 1 document progress migration is not applied.");
    }

    currentStep = "synthetic document database insert";
    await db.insert(documents).values({
      id: createdId,
      title: "Sintetik sənəd · mərhələ 1 yoxlaması",
      body: testBody,
      bodyRich: plainTextDocument(testBody),
      ownerId,
      status: "queued",
      step: "queued",
      progress: { percent: 0, totalChunks: 0, completedChunks: 0 },
    });
    documentId = createdId;
    await db.insert(attachments).values(
      photos.map((photo) => ({
        id: photo.id,
        documentId: createdId,
        storageKey: photo.key,
        mime: "image/png",
        size: pngBytes.length,
        caption: photo.key.split("/").at(-1) ?? "verification.png",
      })),
    );

    currentStep = "private Storage signed image upload, CORS preflight, read, and metadata";
    for (const photo of photos) {
      objectKeys.push(photo.key);
      const uploadUrl = await storage.getSignedUploadUrl(photo.key, "image/png", pngBytes.length);
      const preflight = await fetch(uploadUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "https://analitika-one.vercel.app",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
      });
      const allowedOrigin = preflight.headers.get("access-control-allow-origin");
      const allowedMethods = preflight.headers.get("access-control-allow-methods") ?? "";
      const allowedHeaders = preflight.headers.get("access-control-allow-headers") ?? "";
      if (
        !preflight.ok ||
        (allowedOrigin !== "*" && allowedOrigin !== "https://analitika-one.vercel.app") ||
        !allowedMethods.toLowerCase().includes("put") ||
        !allowedHeaders.toLowerCase().includes("content-type")
      ) {
        throw new Error(
          "Storage did not allow the browser's signed PUT request from the production origin.",
        );
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Origin: "https://analitika-one.vercel.app",
          "content-type": "image/png",
        },
        body: pngBytes,
      });
      if (!uploadResponse.ok) throw new Error("Storage rejected the signed image upload.");
      const metadata = await storage.getMetadata(photo.key);
      if (metadata.size !== pngBytes.length || metadata.contentType !== "image/png") {
        throw new Error("A test image's Storage metadata did not match the upload.");
      }
      const signedUrl = await storage.getSignedUrl(photo.key);
      const response = await fetch(signedUrl);
      const downloaded = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || downloaded.length !== pngBytes.length) {
        throw new Error("A test image could not be read through its signed URL.");
      }
    }

    currentStep = "document chunking, Gemini embedding, and progress persistence";
    await processDocumentJob(createdId);
    const [savedDocument] = await db
      .select({ status: documents.status, step: documents.step, progress: documents.progress })
      .from(documents)
      .where(eq(documents.id, createdId));
    if (savedDocument?.status !== "ready" || savedDocument.step !== "ready") {
      throw new Error("The synthetic document did not reach ready status.");
    }
    if (!savedDocument.progress || typeof savedDocument.progress !== "object") {
      throw new Error("Document progress was not persisted.");
    }

    const savedChunks = await db
      .select({ isTable: chunks.isTable, embedding: chunks.embedding })
      .from(chunks)
      .where(eq(chunks.documentId, createdId));
    if (savedChunks.length === 0 || !savedChunks.some((chunk) => chunk.isTable)) {
      throw new Error("The test table was not saved as an independent table chunk.");
    }
    const vector = savedChunks.find((chunk) => chunk.embedding)?.embedding;
    if (!vector || vector.length !== 768 || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("A stored chunk did not contain a finite 768-dimensional embedding.");
    }
    const photoRows = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.documentId, createdId));
    if (photoRows.length !== 2) throw new Error("The two test photo records were not retained.");
    console.log(
      "Synthetic document reached ready with table chunks, persisted progress, two photos, and 768-dimensional embeddings.",
    );

    currentStep = "document and photo deletion";
    await Promise.all(objectKeys.map((key) => storage.delete(key)));
    objectKeys.length = 0;
    await db.delete(documents).where(eq(documents.id, createdId));
    documentId = undefined;
    const remaining = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, createdId));
    if (remaining.length !== 0) throw new Error("The synthetic document remained after deletion.");
    console.log("Synthetic document, chunks, attachments, and Storage objects were deleted.");

    currentStep = "Gemini embedding provider";
    const embedding = await createGeminiProviders().embeddings.embedQuery(
      "Mərhələ 1 sintetik yoxlama.",
    );
    if (embedding.length !== 768 || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error("Gemini embedding did not return 768 finite dimensions.");
    }
    console.log("Gemini embedding provider returned 768 finite dimensions.");
  } finally {
    await Promise.allSettled(objectKeys.map((key) => storage.delete(key)));
    if (documentId) {
      await db
        .delete(documents)
        .where(eq(documents.id, documentId))
        .catch(() => undefined);
    }
    closeStorage();
    await closeDb();
  }
}

verifyStage1().catch((error: unknown) => {
  const metadata =
    error instanceof Error
      ? (error as Error & { code?: unknown; status?: unknown; statusCode?: unknown })
      : undefined;
  const descriptor = [
    metadata?.name ?? "UnknownError",
    typeof metadata?.code === "string" ? `code=${metadata.code}` : "",
    typeof metadata?.status === "number" ? `status=${metadata.status}` : "",
    typeof metadata?.statusCode === "number" ? `status=${metadata.statusCode}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const failure = error instanceof Error ? (error as Error & { cause?: unknown }) : undefined;
  let reason = failure?.message ?? "Unknown failure";
  if (failure?.cause instanceof Error) reason += `; cause: ${failure.cause.message}`;
  for (const secretName of [
    "DATABASE_URL",
    "DATABASE_URL_MIGRATE",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "S3_SECRET_ACCESS_KEY",
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
  ]) {
    const secret = process.env[secretName];
    if (secret) reason = reason.replaceAll(secret, "[redacted]");
  }
  reason = reason
    .replace(/(?:postgres|postgresql):\/\/[^\s]+/gi, "[redacted database URL]")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted API key]")
    .replaceAll(testBody, "[synthetic document text]")
    .slice(0, 240);
  console.error(`Stage 1 verification failed during ${currentStep} (${descriptor}): ${reason}`);
  process.exitCode = 1;
});
