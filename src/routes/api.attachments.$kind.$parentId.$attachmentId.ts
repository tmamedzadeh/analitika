import { createFileRoute } from "@tanstack/react-router";
import { readAuthorizedAttachment, AttachmentRangeError } from "@/server/storage/attachment-read";
export { readAuthorizedAttachment } from "@/server/storage/attachment-read";

const mimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
};
export async function attachmentResponse(
  kind: string,
  parentId: string,
  attachmentId: string,
  request: Request,
) {
  try {
    const file = await readAuthorizedAttachment(
      kind,
      parentId,
      attachmentId,
      new URL(request.url).searchParams.get("original") === "1",
      request.headers.get("range"),
      request.signal,
    );
    if (!file || !mimeTypes.has(file.mime))
      return new Response(null, { status: 404, headers: privateHeaders });
    const headers = new Headers({
      ...privateHeaders,
      "content-type": file.mime,
      "content-length": String(file.size),
      "accept-ranges": "bytes",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
    if (file.partial) headers.set("content-range", `bytes ${file.start}-${file.end}/${file.total}`);
    return new Response(file.body, { status: file.partial ? 206 : 200, headers });
  } catch (error) {
    const headers = new Headers(privateHeaders);
    if (error instanceof AttachmentRangeError) {
      headers.set("content-range", `bytes */${error.total}`);
      return new Response(null, { status: error.status, headers });
    }
    return new Response(null, { status: 502, headers });
  }
}
export const Route = createFileRoute("/api/attachments/$kind/$parentId/$attachmentId")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        attachmentResponse(params.kind, params.parentId, params.attachmentId, request),
    },
  },
});
