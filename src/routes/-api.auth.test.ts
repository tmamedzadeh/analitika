import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; username: string; passwordHash: string; active: boolean } | null,
  clearLoginAttempts: vi.fn(async (_key: string) => undefined),
  consumeLoginAttempt: vi.fn(async (_key: string, _maximum?: number) => true),
  isLoginAttemptAllowed: vi.fn(async (_key: string, _maximum?: number) => true),
  createSession: vi.fn(async (_userId: string) => ({
    token: "session-token",
    sessionId: "session",
  })),
  loginRateLimitKeys: vi.fn((_request: Request, _username: string) => ["account-key", "ip-key"]),
  pruneLoginAttempts: vi.fn(async () => undefined),
  revokeRequestSession: vi.fn(async (_request: Request) => undefined),
  safeInternalRedirect: vi.fn((value: unknown) =>
    typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/",
  ),
  sessionCookie: vi.fn(
    (token: string, maxAge?: number) =>
      `analitika_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge ?? 28800}`,
  ),
  verifyPassword: vi.fn(async (_password: string, _hash: string | null) => true),
  normalizeUsername: vi.fn((value: string) => value.normalize("NFKC").trim().toLowerCase()),
  select: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  clearLoginAttempts: mocks.clearLoginAttempts,
  consumeLoginAttempt: mocks.consumeLoginAttempt,
  isLoginAttemptAllowed: mocks.isLoginAttemptAllowed,
  createSession: mocks.createSession,
  loginRateLimitKeys: mocks.loginRateLimitKeys,
  pruneLoginAttempts: mocks.pruneLoginAttempts,
  revokeRequestSession: mocks.revokeRequestSession,
  safeInternalRedirect: mocks.safeInternalRedirect,
  sessionCookie: mocks.sessionCookie,
}));

vi.mock("@/server/auth/password", () => ({
  normalizeUsername: mocks.normalizeUsername,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock("@/server/db", () => ({ getDb: () => ({ select: mocks.select }) }));
vi.mock("@/server/db/schema", () => ({
  appUsers: { id: "id", username: "username", passwordHash: "password_hash", active: "active" },
}));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));

import { handleLoginRequest } from "./api.auth.login";
import { handleLogoutRequest } from "./api.auth.logout";

function post(path: string, body?: string, origin = "https://app.example.test") {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    ...(body !== undefined ? { body } : {}),
  });
}

describe("authentication route handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = null;
    mocks.consumeLoginAttempt.mockResolvedValue(true);
    mocks.isLoginAttemptAllowed.mockResolvedValue(true);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => (mocks.user ? [mocks.user] : []) }) }),
    }));
  });

  it("creates a session for a valid login and permits only an internal redirect", async () => {
    mocks.user = {
      id: "user-1",
      username: "analyst",
      passwordHash: "scrypt-hash",
      active: true,
    };

    const response = await handleLoginRequest(
      post(
        "/api/auth/login",
        JSON.stringify({
          username: " Analyst ",
          password: "correct horse battery staple",
          redirect: "/senedler",
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, redirect: "/senedler" });
    expect(mocks.normalizeUsername).toHaveBeenCalledWith(" Analyst ");
    expect(mocks.verifyPassword).toHaveBeenCalledWith(
      "correct horse battery staple",
      "scrypt-hash",
    );
    expect(mocks.createSession).toHaveBeenCalledWith("user-1");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.clearLoginAttempts).toHaveBeenCalledTimes(1);
    expect(mocks.clearLoginAttempts).toHaveBeenCalledWith("account-key");
  });

  it("returns the same credentials error for unknown, inactive, and wrong-password logins", async () => {
    const results: string[] = [];
    const cases = [
      { user: null, passwordMatches: false },
      {
        user: { id: "user-1", username: "analyst", passwordHash: "hash", active: false },
        passwordMatches: true,
      },
      {
        user: { id: "user-1", username: "analyst", passwordHash: "hash", active: true },
        passwordMatches: false,
      },
    ];
    for (const testCase of cases) {
      mocks.user = testCase.user;
      mocks.verifyPassword.mockResolvedValue(testCase.passwordMatches);
      const response = await handleLoginRequest(
        post("/api/auth/login", JSON.stringify({ username: "analyst", password: "test-password" })),
      );
      results.push(`${response.status}:${(await response.json()).message}`);
    }

    expect(new Set(results)).toEqual(new Set(["401:Invalid username or password."]));
  });

  it("does not create a session after authentication fails", async () => {
    const response = await handleLoginRequest(
      post(
        "/api/auth/login",
        JSON.stringify({
          username: "analyst",
          password: "wrong",
          redirect: "https://outside.example",
        }),
      ),
    );

    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests and limits repeated login attempts", async () => {
    const crossSite = await handleLoginRequest(
      post(
        "/api/auth/login",
        JSON.stringify({ username: "analyst", password: "password" }),
        "https://outside.example",
      ),
    );
    expect(crossSite.status).toBe(403);
    expect(mocks.consumeLoginAttempt).not.toHaveBeenCalled();

    mocks.isLoginAttemptAllowed.mockResolvedValueOnce(false);
    const limited = await handleLoginRequest(
      post("/api/auth/login", JSON.stringify({ username: "analyst", password: "password" })),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.consumeLoginAttempt).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies without a content-length header", async () => {
    const response = await handleLoginRequest(post("/api/auth/login", "x".repeat(4097)));

    expect(response.status).toBe(400);
    expect(mocks.consumeLoginAttempt).not.toHaveBeenCalled();
  });

  it("revokes the current server session and clears its cookie on logout", async () => {
    const request = post("/api/auth/logout", "", "https://app.example.test");
    const response = await handleLogoutRequest(request);

    expect(response.status).toBe(204);
    expect(mocks.revokeRequestSession).toHaveBeenCalledWith(request);
    expect(mocks.sessionCookie).toHaveBeenCalledWith("", 0);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects cross-site logout without revoking a session", async () => {
    const response = await handleLogoutRequest(
      post("/api/auth/logout", "", "https://outside.example"),
    );

    expect(response.status).toBe(403);
    expect(mocks.revokeRequestSession).not.toHaveBeenCalled();
  });
});
