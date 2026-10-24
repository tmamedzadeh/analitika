import { and, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";

import { briefAccessFilter, documentAccessFilter, getCurrentUser } from "@/server/db/access";
import { getDb } from "@/server/db";
import {
  attachments,
  appUsers,
  briefAttachments,
  dailyBriefs,
  documents,
} from "@/server/db/schema";
import { getStorage } from "@/server/storage/s3";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type Attachment = { key: string; mime: string; name: string };
type BufferedAttachment = Attachment & { body: ArrayBuffer; size: number };

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}

export async function readAuthorizedAttachment(
  kind: string,
  parentId: string,
  attachmentId: string,
  original = false,
): Promise<BufferedAttachment | null> {
  if (
    !["brief", "document"].includes(kind) ||
    !uuidPattern.test(parentId) ||
    !uuidPattern.test(attachmentId)
  )
    return null;
  const user = getCurrentUser();
  return getDb().transaction(async (transaction) => {
    const [activeUser] = await transaction
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
      .for("share")
      .limit(1);
    if (!activeUser) return null;
    const [file] =
      kind === "brief"
        ? await transaction
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
        : await transaction
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
    if (!file || file.size <= 0 || file.size > 10 * 1024 * 1024) return null;
    const derivative =
      !original && file.mime.startsWith("image/") ? file.imageMetadata?.derivative : null;
    let selected = { key: file.key, mime: file.mime, size: file.size, name: file.name };
    if (derivative)
      selected = {
        key: derivative.key,
        mime: derivative.mime,
        size: derivative.size,
        name: (file.name ?? "photo") + ".webp",
      };
    let object;
    try {
      object = await getStorage().getObjectStream(selected.key);
    } catch (error) {
      if (!derivative) throw error;
      selected = { key: file.key, mime: file.mime, size: file.size, name: file.name };
      object = await getStorage().getObjectStream(selected.key);
    }
    const reader = object.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > selected.size || total > 10 * 1024 * 1024) {
          await reader.cancel();
          return null;
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new ArrayBuffer(total);
    const output = new Uint8Array(body);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    if (body.byteLength !== selected.size) return null;
    return { ...selected, name: selected.name ?? "photo", body, size: body.byteLength };
  });
}

export const Route = createFileRoute("/api/attachments/$kind/$parentId/$attachmentId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        let bufferedFile: BufferedAttachment | null = null;
        try {
          bufferedFile = ["document", "brief"].includes(params.kind)
            ? await readAuthorizedAttachment(
                params.kind,
                params.parentId,
                params.attachmentId,
                new URL(request.url).searchParams.get("original") === "1",
              )
            : null;
        } catch {
          return new Response(null, {
            status: 502,
            headers: { "cache-control": "private, no-store, max-age=0" },
          });
        }
        const file = bufferedFile;
        if (!file || !allowedMimeTypes.has(file.mime)) return notFound();

        try {
          const headers = new Headers({
            "cache-control": "private, no-store, max-age=0",
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "content-type": file.mime,
            "cross-origin-resource-policy": "same-origin",
            "x-content-type-options": "nosniff",
          });
          const body = file.body;
          const size = file.size;
          if (size !== undefined) headers.set("content-length", String(size));
          return new Response(body, { headers });
        } catch {
          return new Response(null, {
            status: 502,
            headers: { "cache-control": "private, no-store, max-age=0" },
          });
        }
      },
    },
  },
});
