import { createFileRoute } from "@tanstack/react-router";

import { revokeRequestSession, sessionCookie } from "@/server/auth";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function handleLogoutRequest(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  await revokeRequestSession(request);
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": sessionCookie("", 0),
    },
  });
}

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLogoutRequest(request),
    },
  },
});
