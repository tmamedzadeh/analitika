import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { getUserForRequest, safeInternalRedirect, withCurrentUser } from "./server/auth";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Unhandled application error.");
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const sessionMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { pathname, search } = new URL(request.url);
  const publicAsset =
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/_build/") ||
    pathname === "/logo.png" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt";
  if (
    publicAsset ||
    pathname === "/api/inngest" ||
    pathname.startsWith("/api/inngest/") ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout"
  ) {
    return next();
  }

  const user = await getUserForRequest(request);
  if (pathname === "/login") {
    if (user) {
      return new Response(null, {
        status: 302,
        headers: { location: "/", "cache-control": "no-store" },
      });
    }
    return next();
  }

  if (!user) {
    const headers = new Headers({ "cache-control": "no-store" });
    const isDocumentNavigation =
      request.method === "GET" &&
      (request.headers.get("sec-fetch-dest") === "document" ||
        request.headers.get("accept")?.includes("text/html") === true);
    if (isDocumentNavigation) {
      const target = safeInternalRedirect(`${pathname}${search}`);
      headers.set("location", `/login?redirect=${encodeURIComponent(target)}`);
      return new Response(null, { status: 302, headers });
    }
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ message: "Authentication required." }), {
      status: 401,
      headers,
    });
  }

  const response = await withCurrentUser(user, () => next());
  if (response instanceof Response) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
    const vary = response.headers.get("vary");
    if (
      !vary
        ?.toLowerCase()
        .split(/\s*,\s*/)
        .includes("cookie")
    ) {
      response.headers.set("vary", vary ? `${vary}, cookie` : "cookie");
    }
  }
  return response;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware, sessionMiddleware],
}));
