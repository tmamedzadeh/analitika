/** Scoped storage probe. Writes/deletes exactly one new object containing public synthetic text. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db";
import { getStorage, closeStorage } from "../src/server/storage/s3";
import { requireServerEnv } from "../src/server/env";

const key = `documents/release-${crypto.randomUUID()}/public-probe.txt`;
const storage = getStorage();
const payload = "Synthetic storage release verification.";
const checks: string[] = [];
let uploaded = false;
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
} catch (error) {
  console.error(
    JSON.stringify({ status: "FAIL", errorType: error instanceof Error ? error.name : "unknown" }),
  );
  process.exitCode = 1;
} finally {
  if (uploaded) await storage.delete(key);
  const result = {
    checkedAt: new Date().toISOString(),
    status: process.exitCode ? "FAIL" : "PASS",
    checks,
    corpusObjectsTouched: 0,
  };
  await writeFile("docs/release/STORAGE_INTEGRATION.json", JSON.stringify(result, null, 2) + "\n");
  closeStorage();
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
