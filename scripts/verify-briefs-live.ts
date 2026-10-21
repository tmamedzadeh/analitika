import { and, eq } from "drizzle-orm";

import { imageMimeFromSignature } from "../src/lib/briefs";
import { withProjectEvaluationUser } from "../src/server/evaluation-safety";
import { getCurrentUser } from "../src/server/auth";
import { closeDb, getDb } from "../src/server/db";
import { briefAttachments, dailyBriefs } from "../src/server/db/schema";
import { closeStorage, getStorage } from "../src/server/storage/s3";

const id = crypto.randomUUID();
const storageKey = `briefs/${id}/${crypto.randomUUID()}.png`;
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uXcAAAAASUVORK5CYII=",
    "base64",
  ),
);

let briefCreated = false;
let objectUploaded = false;

try {
  const db = getDb();
  const authorId = await withProjectEvaluationUser(() => getCurrentUser().id);
  const usedDates = new Set(
    (await db.select({ date: dailyBriefs.briefDate }).from(dailyBriefs)).map((row) => row.date),
  );
  const date = Array.from({ length: 3650 }, (_, day) => {
    const value = new Date(Date.UTC(2090, 0, 1 + day));
    return value.toISOString().slice(0, 10);
  }).find((candidate) => !usedDates.has(candidate));
  if (!date) throw new Error("No unused test date available.");

  await db.insert(dailyBriefs).values({
    id,
    briefDate: date,
    title: "Synthetic brief CRUD verification",
    body: "Synthetic test content only.",
    status: "published",
    authorId,
    indexStatus: "none",
  });
  briefCreated = true;

  const [created] = await db
    .select({ title: dailyBriefs.title, status: dailyBriefs.status })
    .from(dailyBriefs)
    .where(eq(dailyBriefs.id, id));
  if (created?.title !== "Synthetic brief CRUD verification" || created.status !== "published") {
    throw new Error("Brief read-back failed.");
  }

  const storage = getStorage();
  const uploadUrl = await storage.getSignedUploadUrl(storageKey, "image/png", 60);
  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (!putResponse.ok) throw new Error("Signed upload failed.");
  objectUploaded = true;

  const metadata = await storage.getMetadata(storageKey);
  const signature = await storage.getPrefix(storageKey, 12);
  if (
    metadata.size !== png.byteLength ||
    metadata.contentType !== "image/png" ||
    imageMimeFromSignature(signature) !== "image/png"
  ) {
    throw new Error("Uploaded object verification failed.");
  }

  await db.insert(briefAttachments).values({
    briefId: id,
    storageKey,
    name: "synthetic-verification.png",
    mime: "image/png",
    size: png.byteLength,
    ord: 0,
  });
  const [attachment] = await db
    .select({ id: briefAttachments.id })
    .from(briefAttachments)
    .where(and(eq(briefAttachments.briefId, id), eq(briefAttachments.storageKey, storageKey)));
  if (!attachment) throw new Error("Attachment read-back failed.");

  const signedReadUrl = await storage.getSignedUrl(storageKey, 3600);
  const getResponse = await fetch(signedReadUrl);
  const downloaded = new Uint8Array(await getResponse.arrayBuffer());
  if (!getResponse.ok || imageMimeFromSignature(downloaded.slice(0, 12)) !== "image/png") {
    throw new Error("Signed download failed.");
  }

  await storage.delete(storageKey);
  objectUploaded = false;
  await db.delete(dailyBriefs).where(eq(dailyBriefs.id, id));
  briefCreated = false;
  const [deleted] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(eq(dailyBriefs.id, id));
  if (deleted) throw new Error("Brief delete failed.");

  console.log(
    "Brief DB write/read/delete, attachment cascade, signed upload/download, and Storage delete passed.",
  );
} catch {
  console.error("Brief live verification failed; no test content or credentials were logged.");
  process.exitCode = 1;
} finally {
  if (objectUploaded)
    await getStorage()
      .delete(storageKey)
      .catch(() => undefined);
  if (briefCreated)
    await getDb()
      .delete(dailyBriefs)
      .where(eq(dailyBriefs.id, id))
      .catch(() => undefined);
  closeStorage();
  await closeDb();
}
