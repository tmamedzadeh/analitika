import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { Buffer } from "node:buffer";
import process from "node:process";

import { renderErrorPage } from "./lib/error-page";
import { readServerEnv } from "./server/env";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const basicAuthMiddleware = createMiddleware().server(async ({ next, request }) => {
  const credentials = readServerEnv().DEMO_BASIC_AUTH;
  const pathname = new URL(request.url).pathname;

  if (
    !credentials ||
    pathname === "/api/inngest" ||
    pathname.startsWith("/api/inngest/")
  ) {
    return next();
  }

  const authorization = request.headers.get("authorization");
  const [scheme, encodedCredentials] = authorization?.split(/\s+/, 2) ?? [];
  let suppliedCredentials = "";

  if (scheme?.toLowerCase() === "basic" && encodedCredentials) {
    try {
      suppliedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
    } catch {
      suppliedCredentials = "";
    }
  }

  if (!suppliedCredentials || suppliedCredentials !== credentials) {
    return new Response("Kimlik doğrulaması tələb olunur.", {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Basic realm="Analitika", charset="UTF-8"',
      },
    });
  }

  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, basicAuthMiddleware, csrfMiddleware],
}));
