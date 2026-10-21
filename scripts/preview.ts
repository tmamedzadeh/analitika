/** Local HTTP adapter for the actual Vercel web-entry artifact produced by bun run build. */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";

process.env["NODE_ENV"] = "production";
const port = Number(process.argv[2] ?? 4175);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid preview port.");
const origin = `http://127.0.0.1:${port}`;
const staticRoot = resolve(".vercel/output/static");
const entryPath = resolve(".vercel/output/functions/__server.func/index.mjs");
const { default: handler } = (await import(pathToFileURL(entryPath).href)) as {
  default: { fetch(request: Request, context?: unknown): Promise<Response> };
};
const types: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", origin);
    const filePath = resolve(staticRoot, "." + decodeURIComponent(url.pathname));
    const file =
      filePath.startsWith(staticRoot + sep) &&
      (incoming.method === "GET" || incoming.method === "HEAD")
        ? await stat(filePath).catch(() => null)
        : null;
    if (file?.isFile()) {
      outgoing.writeHead(200, {
        "content-type": types[extname(filePath)] ?? "application/octet-stream",
        "content-length": file.size,
      });
      if (incoming.method === "HEAD") outgoing.end();
      else createReadStream(filePath).pipe(outgoing);
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const controller = new AbortController();
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) controller.abort();
    });
    const request = new Request(url, {
      method: incoming.method ?? "GET",
      headers,
      signal: controller.signal,
      ...(["GET", "HEAD"].includes(incoming.method ?? "GET")
        ? {}
        : { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" }),
    } as RequestInit);
    const response = await handler.fetch(request, {
      waitUntil: (promise: Promise<unknown>) => {
        void promise.catch(() => undefined);
      },
    });
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") outgoing.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie", cookies);
    if (response.body)
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(outgoing);
    else outgoing.end();
  } catch (error) {
    console.error(
      JSON.stringify({ previewError: error instanceof Error ? error.name : "unknown" }),
    );
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "text/plain" });
    outgoing.end("Preview request failed.");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Production artifact preview: ${origin}`));
