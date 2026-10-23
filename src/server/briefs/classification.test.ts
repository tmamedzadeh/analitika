import { plainTextDocument } from "@/lib/rich-text";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { prepareBriefUploadUrls, saveBriefRecord } from "./mutations";
import { BRIEF_SYSTEM_TITLE } from "@/lib/briefs";

const mocks = vi.hoisted(() => ({ query: vi.fn(), commit: vi.fn(async () => []), sign: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://synthetic.test"),
}));
vi.mock("@/server/analytics/rate-limit", () => ({ consumeIpRateLimit: async () => true }));
vi.mock("@/server/storage/s3", () => ({ getStorage: () => ({ getSignedUploadUrl: mocks.sign }) }));
vi.mock("@/server/storage/image-uploads", async (original) => ({
  ...(await original<typeof import("@/server/storage/image-uploads")>()),
  commitImageUploads: mocks.commit,
  discardImageUploads: async () => {},
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => {
      const db = drizzle(mocks.query);
      return {
        ...db,
        select: db.select.bind(db),
        transaction: (read: (tx: typeof db) => unknown) => read(db),
      };
    },
  };
});
const user: SessionUser = {
  id: "writer",
  role: "admin",
  clearance: "special",
  username: "synthetic",
  sessionId: "synthetic",
};
const input = {
  date: "2026-10-22",
  title: "Invented",
  body: "Invented fixture",
  bodyRich: plainTextDocument("Invented fixture"),
  classification: "secret" as const,
  status: "published" as const,
  keepAttachmentIds: [],
};
beforeEach(() => vi.clearAllMocks());

describe("bulletin classification at both upload/save stages", () => {
  it("saves canonical JSON and its server projection together with a system-generated title", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.query
      .mockResolvedValueOnce({ rows: [["admin", "special"]] })
      .mockResolvedValueOnce({ rows: [[user.id, "admin", "special"]] });
    const dispatch = vi.fn(async () => {});
    const attempt = {
      ...input,
      title: "Untrusted title",
      body: "Untrusted text",
      bodyRich: plainTextDocument("Canonical text"),
      briefId: "00000000-0000-4000-8000-000000000001",
      isNew: true,
      uploads: [],
    };
    const result = await withCurrentUser(user, () =>
      saveBriefRecord(attempt, { sendIndexing: dispatch }),
    );
    expect(result.ok).toBe(true);
    const [query, params] = mocks.query.mock.calls.find(([sql]) =>
      String(sql).startsWith('insert into "daily_briefs"'),
    )!;
    expect(query).toContain('"body", "body_rich"');
    expect(params).toContain(BRIEF_SYSTEM_TITLE);
    expect(params).toContain("Canonical text");
    expect(params).toContain(JSON.stringify(plainTextDocument("Canonical text")));
    expect(params).not.toContain("Untrusted text");
    expect(params).not.toContain("Untrusted title");
    expect(dispatch).toHaveBeenCalledWith(attempt.briefId);
  });
  it("rejects upload preparation above live clearance before issuing any signed URL", async () => {
    mocks.query.mockResolvedValue({ rows: [[user.id, "admin", "open"]] });
    await expect(
      withCurrentUser(user, () =>
        prepareBriefUploadUrls({
          ...input,
          photos: [{ name: "invented.png", mime: "image/png", size: 10 }],
        }),
      ),
    ).rejects.toThrow();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0]?.[0]).toContain("for share");
  });
  it("checks live clearance again inside the save transaction after storage preparation", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [["admin", "special"]] })
      .mockResolvedValueOnce({ rows: [[user.id, "admin", "open"]] });
    await expect(
      withCurrentUser(user, () =>
        saveBriefRecord({
          ...input,
          briefId: "00000000-0000-4000-8000-000000000001",
          isNew: true,
          uploads: [],
        }),
      ),
    ).rejects.toThrow();
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls.some(([query]) => String(query).startsWith("insert"))).toBe(
      false,
    );
    expect(mocks.query.mock.calls[1]?.[0]).toContain("for share");
  });
});
