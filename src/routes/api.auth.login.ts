import { eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  clearLoginAttempts,
  consumeLoginAttempt,
  createSession,
  loginRateLimitKeys,
  pruneLoginAttempts,
  safeInternalRedirect,
  sessionCookie,
} from "@/server/auth";
import { normalizeUsername, verifyPassword } from "@/server/auth/password";
import { getDb } from "@/server/db";
import { appUsers } from "@/server/db/schema";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(256),
});

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function json(data: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

async function readLimitedBody(request: Request, maximumBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function handleLoginRequest(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ message: "Request rejected." }, 403);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 4096) return json({ message: "Invalid request." }, 400);

  let body: unknown;
  try {
    const raw = await readLimitedBody(request, 4096);
    if (raw === null) return json({ message: "Invalid request." }, 400);
    body = JSON.parse(raw);
  } catch {
    return json({ message: "Invalid username or password." }, 401);
  }
  const parsed = loginSchema.safeParse(body);
  const username = parsed.success ? normalizeUsername(parsed.data.username) : "invalid";
  const password = parsed.success ? parsed.data.password : "invalid-password";
  const keys = loginRateLimitKeys(request, username);
  await pruneLoginAttempts();
  const limits = await Promise.all(
    keys.map((key, index) => consumeLoginAttempt(key, index === 0 ? 10 : 60)),
  );
  if (limits.some((allowed) => !allowed)) {
    return json({ message: "Too many attempts. Try again later." }, 429, {
      "retry-after": "900",
    });
  }

  const [user] = parsed.success
    ? await getDb()
        .select({
          id: appUsers.id,
          username: appUsers.username,
          passwordHash: appUsers.passwordHash,
          active: appUsers.active,
        })
        .from(appUsers)
        .where(eq(appUsers.username, username))
        .limit(1)
    : [];
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? null);
  if (!parsed.success || !user?.active || !passwordMatches) {
    return json({ message: "Invalid username or password." }, 401);
  }

  await Promise.all(keys.map((key) => clearLoginAttempts(key)));
  const { token } = await createSession(user.id);
  return json(
    { ok: true, redirect: safeInternalRedirect((body as { redirect?: unknown }).redirect) },
    200,
    { "set-cookie": sessionCookie(token) },
  );
}

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLoginRequest(request),
    },
  },
});
