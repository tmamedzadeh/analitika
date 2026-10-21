import { inArray, lt } from "drizzle-orm";

import { getDb } from "@/server/db";
import { attachments, briefAttachments, rateLimits } from "@/server/db/schema";
import { getStorage } from "@/server/storage/s3";
import { findStaleUnreferencedStorageObjects } from "@/server/storage/orphans";

const STORAGE_PREFIXES = ["documents/", "briefs/"] as const;
const SQL_BATCH_SIZE = 500;

async function referencedKeysInBatch(keys: string[]): Promise<Set<string>> {
  const db = getDb();
  const [documentFiles, briefFiles] = await Promise.all([
    db
      .select({ key: attachments.storageKey })
      .from(attachments)
      .where(inArray(attachments.storageKey, keys)),
    db
      .select({ key: briefAttachments.storageKey })
      .from(briefAttachments)
      .where(inArray(briefAttachments.storageKey, keys)),
  ]);
  return new Set([...documentFiles, ...briefFiles].map(({ key }) => key));
}

export async function cleanupOrphanedStorageUploads(now = new Date()): Promise<{
  inspected: number;
  deleted: number;
}> {
  const storage = getStorage();
  await getDb()
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  const pages = await Promise.all(STORAGE_PREFIXES.map((prefix) => storage.listObjects(prefix)));
  const candidates = pages.flat();
  const staleCandidates = findStaleUnreferencedStorageObjects(candidates, new Set(), now).map(
    (key) => candidates.find((candidate) => candidate.key === key)!,
  );
  const referenced = new Set<string>();
  for (let offset = 0; offset < staleCandidates.length; offset += SQL_BATCH_SIZE) {
    const batch = staleCandidates.slice(offset, offset + SQL_BATCH_SIZE);
    const keys = batch.map(({ key }) => key);
    for (const key of await referencedKeysInBatch(keys)) referenced.add(key);
  }
  const orphans = findStaleUnreferencedStorageObjects(staleCandidates, referenced, now);
  const results = await Promise.allSettled(orphans.map((key) => storage.delete(key)));
  return {
    inspected: candidates.length,
    deleted: results.filter((result) => result.status === "fulfilled").length,
  };
}
