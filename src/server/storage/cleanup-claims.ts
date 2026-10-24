import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  attachments,
  briefAttachments,
  documentImageUploads,
  imageUploadObjects,
} from "../db/schema";

export async function imageSessionSchemaExists() {
  const result = await getDb().execute(
    sql`select to_regclass('public.image_upload_objects') is not null as present`,
  );
  return Boolean(result[0]?.["present"]);
}

/** Publication takes the same object lock and rejects 'deleting'. Never lock during S3 DELETE. */
export async function claimImageObjectDeletion(key: string, now: Date) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    await tx.execute(sql`set local lock_timeout = '1s'`);
    const [object] = await tx
      .select()
      .from(imageUploadObjects)
      .where(eq(imageUploadObjects.key, key))
      .for("update")
      .limit(1);
    const [documentRef] = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        or(
          eq(attachments.storageKey, key),
          eq(sql<string>`${attachments.imageMetadata}->'derivative'->>'key'`, key),
        ),
      )
      .limit(1);
    const [briefRef] = await tx
      .select({ id: briefAttachments.id })
      .from(briefAttachments)
      .where(
        or(
          eq(briefAttachments.storageKey, key),
          eq(sql<string>`${briefAttachments.imageMetadata}->'derivative'->>'key'`, key),
        ),
      )
      .limit(1);
    if (documentRef || briefRef) return false;
    if (!object) return true; // Legacy immutable object, already older than the safety window.
    if (object.protectUntil > now) return false;
    if (object.uploadId) {
      const [session] = await tx
        .select()
        .from(documentImageUploads)
        .where(eq(documentImageUploads.id, object.uploadId))
        .limit(1);
      if (
        session &&
        ((session.leaseUntil && session.leaseUntil > now) ||
          (session.expiresAt > now && !["ready", "cancelled", "expired"].includes(session.state)))
      )
        return false;
    }
    await tx
      .update(imageUploadObjects)
      .set({ state: "deleting" })
      .where(eq(imageUploadObjects.key, key));
    return true;
  });
}

export async function expireImageSessions(now: Date) {
  await getDb()
    .update(documentImageUploads)
    .set({ state: "expired", leaseId: null, leaseUntil: null })
    .where(
      and(
        sql`${documentImageUploads.expiresAt} <= ${now}`,
        inArray(documentImageUploads.state, ["pending", "uploading", "checking", "failed"]),
        or(
          sql`${documentImageUploads.leaseUntil} is null`,
          sql`${documentImageUploads.leaseUntil} <= ${now}`,
        ),
      ),
    );
}
