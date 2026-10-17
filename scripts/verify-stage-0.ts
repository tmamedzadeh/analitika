import { eq } from "drizzle-orm";
import process from "node:process";
import postgres from "postgres";

import { createGeminiProviders } from "../src/server/ai/gemini";
import { closeDb, getDb } from "../src/server/db";
import { documents } from "../src/server/db/schema";
import { requireServerEnv } from "../src/server/env";
import { closeStorage, getStorage } from "../src/server/storage/s3";

const requiredExtensions = ["vector", "pg_trgm"] as const;
const requiredTables = [
  "documents",
  "document_acl",
  "chunks",
  "attachments",
  "info_requests",
  "request_attachments",
  "osint_runs",
  "osint_sources",
  "osint_cache",
  "query_logs",
  "eval_sets",
  "eval_questions",
  "eval_runs",
  "eval_results",
] as const;
let currentStep = "database extensions and tables";

async function verifyDatabaseObjects(): Promise<void> {
  const client = postgres(requireServerEnv("DATABASE_URL"), { prepare: false, max: 1 });
  try {
    const extensions = await client`
      SELECT extname FROM pg_extension
      WHERE extname IN ('vector', 'pg_trgm')
    `;
    const installedExtensions = new Set(extensions.map((row) => row.extname));
    const missingExtensions = requiredExtensions.filter((name) => !installedExtensions.has(name));
    if (missingExtensions.length > 0) {
      throw new Error("Missing database extensions: " + missingExtensions.join(", "));
    }

    const tables = await client`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const existingTables = new Set(tables.map((row) => row.table_name));
    const missingTables = requiredTables.filter((name) => !existingTables.has(name));
    if (missingTables.length > 0) {
      throw new Error("Missing stage 0 tables: " + missingTables.join(", "));
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function verifyGemini(): Promise<void> {
  currentStep = "Gemini chat request";
  const providers = createGeminiProviders();
  const response = await providers.analytics.generateText({
    prompt: "Cavab olaraq yalnız OK yaz.",
  });
  if (!response.trim()) throw new Error("Gemini chat returned an empty response.");

  currentStep = "Gemini embedding request";
  const embedding = await providers.embeddings.embedQuery("Mərhələ 0 embedding yoxlaması.");
  if (embedding.length !== 768 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("Gemini embedding did not return 768 finite dimensions.");
  }
}

async function verifyStage0(): Promise<void> {
  await verifyDatabaseObjects();
  console.log("Database extensions and stage 0 tables are present.");

  currentStep = "database insert and read";
  const db = getDb();
  const storage = getStorage();
  const payload = "Analitika stage 0 service verification";
  const objectKey = "stage-0-check/" + crypto.randomUUID() + ".txt";
  let documentId: string | undefined;
  let objectUploaded = false;

  try {
    const inserted = await db
      .insert(documents)
      .values({
        title: "Mərhələ 0 xidmət yoxlaması",
        body: payload,
        status: "ready",
      })
      .returning({ id: documents.id });

    const document = inserted[0];
    if (!document) throw new Error("Database did not return the verification record.");
    documentId = document.id;

    const saved = await db
      .select({ id: documents.id, body: documents.body })
      .from(documents)
      .where(eq(documents.id, documentId));
    if (saved[0]?.body !== payload) {
      throw new Error("Database verification record could not be read back.");
    }

    currentStep = "private Storage upload";
    await storage.put({
      key: objectKey,
      body: new TextEncoder().encode(payload),
      contentType: "text/plain; charset=utf-8",
    });
    objectUploaded = true;

    currentStep = "private Storage signed download";
    const signedUrl = await storage.getSignedUrl(objectKey);
    const response = await fetch(signedUrl);
    const downloaded = await response.text();
    if (!response.ok || downloaded !== payload) {
      throw new Error("Private storage signed read did not return the uploaded file.");
    }

    currentStep = "private Storage delete";
    await storage.delete(objectKey);
    objectUploaded = false;
    await db.delete(documents).where(eq(documents.id, documentId));
    documentId = undefined;

    console.log("Database insert/read and private Storage upload/signed read/delete passed.");
    await verifyGemini();
    console.log("Gemini chat and 768-dimensional embedding passed.");
  } finally {
    if (objectUploaded) await storage.delete(objectKey);
    if (documentId) await db.delete(documents).where(eq(documents.id, documentId));
    closeStorage();
    await closeDb();
  }
}

verifyStage0().catch((error: unknown) => {
  const metadata =
    error instanceof Error
      ? (error as Error & { code?: unknown; status?: unknown; statusCode?: unknown })
      : undefined;
  const descriptor = [
    metadata?.name ?? "UnknownError",
    typeof metadata?.code === "string" ? "code=" + metadata.code : "",
    typeof metadata?.status === "number" ? "status=" + metadata.status : "",
    typeof metadata?.statusCode === "number" ? "status=" + metadata.statusCode : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.error("Stage 0 verification failed during " + currentStep + " (" + descriptor + ").");
  process.exitCode = 1;
});
