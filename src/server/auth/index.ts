import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";

import { getDb } from "@/server/db";
import { appSessions, appUsers, authLoginAttempts } from "@/server/db/schema";

export const clearanceValues = ["open", "secret", "top_secret", "special"] as const;
export type Clearance = (typeof clearanceValues)[number];
export type UserRole = "admin" | "user";

export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
  clearance: Clearance;
  sessionId: string;
};

const userContext = new AsyncLocalStorage<SessionUser>();
export const SESSION_COOKIE_NAME = "analitika_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export class AuthorizationError extends Error {
  readonly statusCode: number;

  constructor(message = "Access denied.", statusCode = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.statusCode = statusCode;
  }
}

export function withCurrentUser<T>(user: SessionUser, callback: () => T): T {
  return userContext.run(user, callback);
}

export function getCurrentUser(): SessionUser {
  const user = userContext.getStore();
  if (!user) throw new AuthorizationError("Authentication required.", 401);
  return user;
}

export function requireAdmin(): SessionUser {
  const user = getCurrentUser();
  if (user.role !== "admin") throw new AuthorizationError();
  return user;
}

export function canAccessClassification(
  user: Pick<SessionUser, "clearance">,
  classification: string,
) {
  const userLevel = clearanceValues.indexOf(user.clearance);
  const requestedLevel = clearanceValues.indexOf(classification as Clearance);
  return userLevel >= 0 && requestedLevel >= 0 && requestedLevel <= userLevel;
}

export function allowedClassifications(user: Pick<SessionUser, "clearance">): Clearance[] {
  const level = clearanceValues.indexOf(user.clearance);
  return level < 0 ? [] : clearanceValues.slice(0, level + 1);
}

export function readSessionCookie(request: Request): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
  return entry?.slice(prefix.length) || null;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function safeInternalRedirect(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  try {
    const url = new URL(value, "https://analitika.invalid");
    return url.origin === "https://analitika.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; sessionId: string }> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await db.delete(appSessions).where(lte(appSessions.expiresAt, now));
  await db.insert(appSessions).values({
    id: sessionId,
    userId,
    tokenHash: tokenHash(token),
    expiresAt,
  });
  return { token, sessionId };
}

export async function getUserForRequest(request: Request): Promise<SessionUser | null> {
  const token = readSessionCookie(request);
  if (!token || token.length > 128) return null;
  const hash = tokenHash(token);
  const db = getDb();
  const [row] = await db
    .select({
      id: appUsers.id,
      username: appUsers.username,
      role: appUsers.role,
      clearance: appUsers.clearance,
      active: appUsers.active,
      sessionId: appSessions.id,
    })
    .from(appSessions)
    .innerJoin(appUsers, eq(appSessions.userId, appUsers.id))
    .where(
      and(
        eq(appSessions.tokenHash, hash),
        eq(appUsers.active, true),
        gt(appSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) {
    await db.delete(appSessions).where(eq(appSessions.tokenHash, hash));
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    clearance: row.clearance as Clearance,
    sessionId: row.sessionId,
  };
}

export async function revokeRequestSession(request: Request): Promise<void> {
  const token = readSessionCookie(request);
  if (!token || token.length > 128) return;
  await getDb()
    .delete(appSessions)
    .where(eq(appSessions.tokenHash, tokenHash(token)));
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const db = getDb();
  if (exceptSessionId) {
    await db
      .delete(appSessions)
      .where(and(eq(appSessions.userId, userId), sql`${appSessions.id} <> ${exceptSessionId}`));
  } else {
    await db.delete(appSessions).where(eq(appSessions.userId, userId));
  }
}

export function loginRateLimitKeys(request: Request, username: string): string[] {
  const forwarded =
    request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0];
  const address = (forwarded ?? "unknown").trim().slice(0, 100);
  const loginIpKey = createHash("sha256")
    .update(`login-ip\u0000${username}\u0000${address}`)
    .digest("hex");
  const ipKey = createHash("sha256").update(`ip\u0000${address}`).digest("hex");
  return [loginIpKey, ipKey];
}

export async function isLoginAttemptAllowed(key: string, maximum = 10): Promise<boolean> {
  const [attempt] = await getDb()
    .select({ attempts: authLoginAttempts.attempts, windowStart: authLoginAttempts.windowStart })
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.key, key))
    .limit(1);
  if (!attempt || attempt.windowStart <= new Date(Date.now() - 15 * 60_000)) return true;
  return attempt.attempts < maximum;
}

export async function consumeLoginAttempt(key: string, maximum = 10): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60_000);
  const windowStartParam = sql.param(windowStart, authLoginAttempts.windowStart);
  const nowParam = sql.param(now, authLoginAttempts.windowStart);
  const [attempt] = await db
    .insert(authLoginAttempts)
    .values({ key, windowStart: now, attempts: 1 })
    .onConflictDoUpdate({
      target: authLoginAttempts.key,
      set: {
        windowStart: sql`case when ${authLoginAttempts.windowStart} <= ${windowStartParam} then ${nowParam} else ${authLoginAttempts.windowStart} end`,
        attempts: sql`case when ${authLoginAttempts.windowStart} <= ${windowStartParam} then 1 else ${authLoginAttempts.attempts} + 1 end`,
      },
    })
    .returning({ attempts: authLoginAttempts.attempts });
  const attempts = attempt?.attempts ?? maximum + 1;
  const delayMs = loginAttemptDelay(attempts);
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  return attempts <= maximum;
}

export function loginAttemptDelay(attempts: number): number {
  return attempts < 3 ? 0 : Math.min(8_000, 250 * 2 ** Math.min(attempts - 3, 5));
}

export async function pruneLoginAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  await getDb().delete(authLoginAttempts).where(lte(authLoginAttempts.windowStart, cutoff));
}

export async function clearLoginAttempts(key: string): Promise<void> {
  await getDb().delete(authLoginAttempts).where(eq(authLoginAttempts.key, key));
}
