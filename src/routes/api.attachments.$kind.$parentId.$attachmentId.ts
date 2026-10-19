import { and, eq, or } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";

import { accessFilter, documentAccessFilter, getCurrentUser } from "@/server/db/access";
import { getDb } from "@/server/db";
import {
  attachments,
  briefAttachments,
  dailyBriefs,
  documents,
  infoRequests,
  requestAttachments,
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

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}

async function findAttachment(
  kind: string,
  parentId: string,
  attachmentId: string,
): Promise<Attachment | null> {
  if (!uuidPattern.test(parentId) || !uuidPattern.test(attachmentId)) return null;
  const db = getDb();

  if (kind === "document") {
    const [file] = await db
      .select({ key: attachments.storageKey, mime: attachments.mime, name: attachments.caption })
      .from(attachments)
      .innerJoin(documents, eq(attachments.documentId, documents.id))
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.documentId, parentId),
          documentAccessFilter(),
        ),
      )
      .limit(1);
    return file ? { ...file, name: file.name ?? "photo" } : null;
  }

  if (kind === "request") {
    const user = getCurrentUser();
    const ownerFilter =
      user.role === "admin"
        ? or(eq(infoRequests.requesterId, user.id), eq(infoRequests.requesterId, "admin"))
        : eq(infoRequests.requesterId, user.id);
    const [file] = await db
      .select({
        key: requestAttachments.storageKey,
        mime: requestAttachments.mime,
        name: requestAttachments.name,
      })
      .from(requestAttachments)
      .innerJoin(infoRequests, eq(requestAttachments.requestId, infoRequests.id))
      .where(
        and(
          eq(requestAttachments.id, attachmentId),
          eq(requestAttachments.requestId, parentId),
          ownerFilter,
        ),
      )
      .limit(1);
    return file ?? null;
  }

  if (kind === "brief") {
    const [file] = await db
      .select({
        key: briefAttachments.storageKey,
        mime: briefAttachments.mime,
        name: briefAttachments.name,
      })
      .from(briefAttachments)
      .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
      .where(
        and(
          eq(briefAttachments.id, attachmentId),
          eq(briefAttachments.briefId, parentId),
          accessFilter(),
        ),
      )
      .limit(1);
    return file ?? null;
  }

  return null;
}

export const Route = createFileRoute("/api/attachments/$kind/$parentId/$attachmentId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const file = await findAttachment(params.kind, params.parentId, params.attachmentId);
        if (!file || !allowedMimeTypes.has(file.mime)) return notFound();

        try {
          const object = await getStorage().getObjectStream(file.key);
          const headers = new Headers({
            "cache-control": "private, no-store, max-age=0",
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "content-type": file.mime,
            "cross-origin-resource-policy": "same-origin",
            "x-content-type-options": "nosniff",
          });
          if (object.size !== undefined) headers.set("content-length", String(object.size));
          return new Response(object.body, { headers });
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
