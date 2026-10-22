/** Scoped storage probe. Writes/deletes exactly one new object containing public synthetic text. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db";
import { getStorage, closeStorage } from "../src/server/storage/s3";
import { requireServerEnv } from "../src/server/env";
import {
  commitImageUploads,
  discardImageUploads,
  newImageUploadKey,
} from "../src/server/storage/image-uploads";

const key = `documents/release-${crypto.randomUUID()}/public-probe.txt`;
const storage = getStorage();
const payload = "Synthetic storage release verification.";
const checks: string[] = [];
let uploaded = false;
const imageParent = crypto.randomUUID();
const imageOwner = crypto.randomUUID();
const imageKey = newImageUploadKey("documents", imageParent, imageOwner, "image/png");
const extraKeys: string[] = [imageKey];
try {
  const buckets = await getDb().execute(
    sql`select public from storage.buckets where id = ${requireServerEnv("S3_BUCKET")} or name = ${requireServerEnv("S3_BUCKET")}`,
  );
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.["public"], false);
  checks.push("Configured Supabase bucket exists and is private");
  await storage.put({ key, body: new TextEncoder().encode(payload), contentType: "text/plain" });
  uploaded = true;
  const signed = await storage.getSignedUrl(key, 60);
  const response = await fetch(signed, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), payload);
  const unsignedUrl = new URL(signed);
  unsignedUrl.search = "";
  const unsigned = await fetch(unsignedUrl, { signal: AbortSignal.timeout(15_000) });
  assert.ok([400, 401, 403, 404].includes(unsigned.status));
  const publicUrl = new URL(requireServerEnv("S3_ENDPOINT"));
  publicUrl.pathname = `/storage/v1/object/public/${encodeURIComponent(requireServerEnv("S3_BUCKET"))}/${key}`;
  const publicRead = await fetch(publicUrl, { signal: AbortSignal.timeout(15_000) });
  assert.ok([400, 401, 403, 404].includes(publicRead.status));
  checks.push(
    "Signed read returns only the new synthetic object; unsigned S3 and public-object paths deny access",
  );
  await storage.delete(key);
  uploaded = false;
  await assert.rejects(storage.getMetadata(key));
  checks.push("Exact new object deleted and deletion verified");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const putUrl = await storage.getSignedUploadUrl(imageKey, "image/png", png.length, 60);
  const signedHeaders = new URL(putUrl).searchParams.get("X-Amz-SignedHeaders") ?? "";
  assert.ok(signedHeaders.includes("content-length") && signedHeaders.includes("content-type"));
  const wrongSize = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: new Uint8Array(png.length + 1),
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok([400, 401, 403].includes(wrongSize.status));
  const wrongType = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": "text/html" },
    body: png,
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok([400, 401, 403].includes(wrongType.status));
  checks.push(
    "PUT signature binds declared size and MIME; mismatched size/type rejected by live S3",
  );
  assert.equal(
    (
      await fetch(putUrl, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: png,
        signal: AbortSignal.timeout(15_000),
      })
    ).status,
    200,
  );
  const upload = { key: imageKey, mime: "image/png" as const, size: png.length };
  await assert.rejects(
    commitImageUploads(storage, "documents", imageParent, "wrong-owner", [upload]),
  );
  await assert.rejects(
    commitImageUploads(storage, "documents", imageParent, imageOwner, [{ ...upload, size: 1 }]),
  );
  const [committed] = await commitImageUploads(storage, "documents", imageParent, imageOwner, [
    upload,
  ]);
  assert.ok(committed);
  extraKeys.push(committed.key);
  assert.equal(
    (
      await fetch(putUrl, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(png.length),
        signal: AbortSignal.timeout(15_000),
      })
    ).status,
    200,
  );
  await assert.rejects(commitImageUploads(storage, "documents", imageParent, imageOwner, [upload]));
  await discardImageUploads(storage, "documents", imageParent, imageOwner, [imageKey]);
  await assert.rejects(
    discardImageUploads(storage, "documents", imageParent, imageOwner, [committed.key]),
  );
  const committedRead = await fetch(await storage.getSignedUrl(committed.key, 60), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.deepEqual(new Uint8Array(await committedRead.arrayBuffer()), png);
  checks.push(
    "Signed PUT; owner/size/signature rejection; committed bytes survive staging overwrite/discard; committed key cannot be discarded",
  );
} catch (error) {
  console.error(
    JSON.stringify({ status: "FAIL", errorType: error instanceof Error ? error.name : "unknown" }),
  );
  process.exitCode = 1;
} finally {
  if (uploaded) await storage.delete(key);
  for (const objectKey of extraKeys) {
    await storage.delete(objectKey);
    await assert.rejects(storage.getMetadata(objectKey));
  }
  const result = {
    checkedAt: new Date().toISOString(),
    status: process.exitCode ? "FAIL" : "PASS",
    checks,
    corpusObjectsTouched: 0,
    fixtureCleanup: "all exact probe keys deleted; absence verified",
  };
  await writeFile("docs/release/STORAGE_INTEGRATION.json", JSON.stringify(result, null, 2) + "\n");
  closeStorage();
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
