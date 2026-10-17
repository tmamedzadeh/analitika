import { eq } from "drizzle-orm";
import process from "node:process";

import { closeDb, getDb } from "../src/server/db";
import { documents } from "../src/server/db/schema";
import { closeStorage, getStorage } from "../src/server/storage/s3";

async function verifyStage0(): Promise<void> {
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

    await storage.put({
      key: objectKey,
      body: new TextEncoder().encode(payload),
      contentType: "text/plain; charset=utf-8",
    });
    objectUploaded = true;

    const signedUrl = await storage.getSignedUrl(objectKey);
    const response = await fetch(signedUrl);
    const downloaded = await response.text();
    if (!response.ok || downloaded !== payload) {
      throw new Error("Private storage signed read did not return the uploaded file.");
    }

    await storage.delete(objectKey);
    objectUploaded = false;
    await db.delete(documents).where(eq(documents.id, documentId));
    documentId = undefined;

    console.log(
      "Database insert/read and private Storage upload/signed read/delete passed.",
    );
  } finally {
    if (objectUploaded) await storage.delete(objectKey);
    if (documentId) await db.delete(documents).where(eq(documents.id, documentId));
    closeStorage();
    await closeDb();
  }
}

verifyStage0().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
