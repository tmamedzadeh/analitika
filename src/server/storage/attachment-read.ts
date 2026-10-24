import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { attachments, appUsers, briefAttachments, dailyBriefs, documents } from "../db/schema";
import { briefAccessFilter, documentAccessFilter, getCurrentUser } from "../db/access";
import { getStorage } from "./s3";
import { readStorageBytes } from "./operations";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ATTACHMENT_RANGE_BYTES = 1024 * 1024;
export class AttachmentRangeError extends Error {
  constructor(
    public readonly status: number,
    public readonly total: number,
  ) {
    super("Attachment range unavailable");
  }
}

async function metadata(kind: string, parentId: string, attachmentId: string, original: boolean) {
  const user = getCurrentUser();
  return getDb().transaction(async (tx) => {
    const [active] = await tx
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
      .for("share")
      .limit(1);
    if (!active) return null;
    const [file] =
      kind === "brief"
        ? await tx
            .select({
              key: briefAttachments.storageKey,
              imageMetadata: briefAttachments.imageMetadata,
              mime: briefAttachments.mime,
              name: briefAttachments.name,
              size: briefAttachments.size,
            })
            .from(briefAttachments)
            .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
            .where(
              and(
                eq(briefAttachments.id, attachmentId),
                eq(briefAttachments.briefId, parentId),
                briefAccessFilter(user),
              ),
            )
            .for("share")
            .limit(1)
        : await tx
            .select({
              key: attachments.storageKey,
              imageMetadata: attachments.imageMetadata,
              mime: attachments.mime,
              name: attachments.caption,
              size: attachments.size,
            })
            .from(attachments)
            .innerJoin(documents, eq(attachments.documentId, documents.id))
            .where(
              and(
                eq(attachments.id, attachmentId),
                eq(attachments.documentId, parentId),
                documentAccessFilter(user),
              ),
            )
            .for("share")
            .limit(1);
    if (!file || file.size < 1 || file.size > 10 * 1024 * 1024) return null;
    const derivative =
      !original && file.mime.startsWith("image/") ? file.imageMetadata?.derivative : null;
    return derivative
      ? {
          key: derivative.key,
          mime: derivative.mime,
          size: derivative.size,
          name: (file.name ?? "photo") + ".webp",
          derivative: true,
        }
      : {
          key: file.key,
          mime: file.mime,
          size: file.size,
          name: file.name ?? "photo",
          derivative: false,
        };
  });
}

export async function readAuthorizedAttachment(
  kind: string,
  parentId: string,
  attachmentId: string,
  original = false,
  range?: string | null,
  signal?: AbortSignal,
) {
  if (!["document", "brief"].includes(kind) || !uuid.test(parentId) || !uuid.test(attachmentId))
    return null;
  let file = await metadata(kind, parentId, attachmentId, original);
  if (!file) return null;
  let start = 0;
  let end = file.size - 1;
  const parseRange = () => {
    end = file!.size - 1;
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw new AttachmentRangeError(416, file!.size);
      start = Number(match[1]);
      end = Math.min(Number(match[2]), file!.size - 1);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        end - start + 1 > ATTACHMENT_RANGE_BYTES
      )
        throw new AttachmentRangeError(416, file!.size);
    } else if (file!.size > 3 * 1024 * 1024) throw new AttachmentRangeError(413, file!.size);
  };
  parseRange();
  let object;
  try {
    object = await getStorage().getObjectStream(file.key, {
      signal,
      ...(range ? { range: { start, end } } : {}),
    });
  } catch (error) {
    if (!file.derivative) throw error;
    file = await metadata(kind, parentId, attachmentId, true);
    if (!file) return null;
    parseRange();
    object = await getStorage().getObjectStream(file.key, {
      signal,
      ...(range ? { range: { start, end } } : {}),
    });
  }
  const bytes = await readStorageBytes(object.body, end - start + 1, { signal });
  // No SQL connection/locks are held during S3 I/O. Revoke/delete while reading fails closed.
  const live = await metadata(kind, parentId, attachmentId, original || !file.derivative);
  if (!live || live.key !== file.key || live.size !== file.size || live.mime !== file.mime)
    return null;
  return {
    ...file,
    body: bytes.buffer as ArrayBuffer,
    size: bytes.length,
    total: file.size,
    start,
    end,
    partial: Boolean(range),
  };
}
