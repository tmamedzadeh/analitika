import { inArray, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/server/db";
import { attachments, briefAttachments, rateLimits } from "@/server/db/schema";
import { getStorage } from "@/server/storage/s3";
import { attachmentKeys } from "@/server/storage/image-metadata";
import { findStaleUnreferencedStorageObjects } from "@/server/storage/orphans";
import {
  claimImageObjectDeletion,
  expireImageSessions,
  imageSessionSchemaExists,
} from "@/server/storage/cleanup-claims";

const STORAGE_PREFIXES = ["documents/", "briefs/"] as const;
const SQL_BATCH_SIZE = 500;

async function referencedKeysInBatch(keys: string[]): Promise<Set<string>> {
  const db = getDb();
  const [documentFiles, briefFiles] = await Promise.all([
    db
      .select({ storageKey: attachments.storageKey, imageMetadata: attachments.imageMetadata })
      .from(attachments)
      .where(
        or(
          inArray(attachments.storageKey, keys),
          inArray(sql<string>`${attachments.imageMetadata}->'derivative'->>'key'`, keys),
        ),
      ),
    db
      .select({
        storageKey: briefAttachments.storageKey,
        imageMetadata: briefAttachments.imageMetadata,
      })
      .from(briefAttachments)
      .where(
        or(
          inArray(briefAttachments.storageKey, keys),
          inArray(sql<string>`${briefAttachments.imageMetadata}->'derivative'->>'key'`, keys),
        ),
      ),
  ]);
  return new Set([...documentFiles, ...briefFiles].flatMap(attachmentKeys));
}

export async function cleanupOrphanedStorageUploads(now = new Date()): Promise<{
  inspected: number;
  deleted: number;
}> {
  const storage = getStorage();
  const deadline = Date.now() + 45_000;
  const sessionSchema = await imageSessionSchemaExists();
  if (sessionSchema) await expireImageSessions(now);
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
  let deleted = 0;
  // Bound concurrency and recheck references at the deletion claim, not just the earlier snapshot.
  for (const key of orphans) {
    if (Date.now() >= deadline) break;
    try {
      if (sessionSchema && !(await claimImageObjectDeletion(key, now))) continue;
      await storage.delete(key);
      deleted++;
    } catch {
      /* Retained for the next bounded sweep. */
    }
  }
  return {
    inspected: candidates.length,
    deleted,
  };
}
