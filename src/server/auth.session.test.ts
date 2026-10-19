import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    username: string;
    role: "admin" | "user";
    clearance: string;
    active: boolean;
    sessionId: string;
  }>,
  select: vi.fn(),
  deleteWhere: vi.fn(async () => undefined),
}));

vi.mock("@/server/db", () => ({
  getDb: () => ({
    select: mocks.select,
    delete: () => ({ where: mocks.deleteWhere }),
  }),
}));

vi.mock("@/server/db/schema", () => ({
  appSessions: {
    id: "session_id",
    tokenHash: "token_hash",
    expiresAt: "expires_at",
    userId: "user_id",
  },
  appUsers: {
    id: "user_id",
    username: "username",
    role: "role",
    clearance: "clearance",
    active: "active",
  },
  authLoginAttempts: { key: "key", windowStart: "window_start", attempts: "attempts" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  gt: (column: unknown, value: unknown) => ({ column, value }),
  lte: (column: unknown, value: unknown) => ({ column, value }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    {
      raw: (value: string) => value,
    },
  ),
}));

import { getUserForRequest } from "./auth";

describe("database-backed session checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
      }),
    }));
  });

  it("requires a cookie before querying the session store", async () => {
    await expect(getUserForRequest(new Request("https://app.example.test/private"))).resolves.toBe(
      null,
    );
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects expired, revoked, and inactive sessions and removes the stale token hash", async () => {
    const request = new Request("https://app.example.test/private", {
      headers: { cookie: "analitika_session=old-session-token" },
    });

    await expect(getUserForRequest(request)).resolves.toBeNull();
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("reloads current role and clearance on every request", async () => {
    const request = new Request("https://app.example.test/private", {
      headers: { cookie: "analitika_session=current-session-token" },
    });
    mocks.rows = [
      {
        id: "user-1",
        username: "analyst",
        role: "user",
        clearance: "top_secret",
        active: true,
        sessionId: "session-1",
      },
    ];

    await expect(getUserForRequest(request)).resolves.toMatchObject({ clearance: "top_secret" });
    mocks.rows[0] = { ...mocks.rows[0]!, clearance: "open" };
    await expect(getUserForRequest(request)).resolves.toMatchObject({ clearance: "open" });
  });
});
