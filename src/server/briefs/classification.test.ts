import { plainTextDocument } from "@/lib/rich-text";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { prepareBriefUploadUrls, saveBriefRecord } from "./mutations";
import { BRIEF_SYSTEM_TITLE } from "@/lib/briefs";
import { getTableColumns } from "drizzle-orm";
import { dailyBriefs } from "@/server/db/schema";

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

describe("open bulletin authorization at both upload/save stages", () => {
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
      summary: "Əməkdaşın yazdığı xülasə.",
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
    expect(params).toContain(attempt.summary);
    expect(params).toContain(JSON.stringify(plainTextDocument("Canonical text")));
    expect(params).not.toContain("Untrusted text");
    expect(params).not.toContain("Untrusted title");
    expect(dispatch).toHaveBeenCalledWith(attempt.briefId);
  });
  it.each(["ready", "processing", "queued", "failed"])(
    "saves only a summary without reindexing or changing the %s index",
    async (indexStatus) => {
      const timestamp = "2026-10-22T12:00:00.000Z";
      const existing = {
        id: "00000000-0000-4000-8000-000000000001",
        briefDate: input.date,
        title: "Legacy bulletin title",
        summary: "Köhnə xülasə.",
        body: input.body,
        bodyRich: JSON.stringify(input.bodyRich),
        status: input.status,
        authorId: user.id,
        updatedBy: user.id,
        indexStatus,
        indexProgress: JSON.stringify({ percent: 100, totalChunks: 1, completedChunks: 1 }),
        createdAt: timestamp,
        updatedAt: timestamp,
        publishedAt: timestamp,
      };
      const row = Object.keys(getTableColumns(dailyBriefs)).map(
        (key) => existing[key as keyof typeof existing],
      );
      mocks.query.mockResolvedValue({ rows: [] });
      mocks.query
        .mockResolvedValueOnce({ rows: [[...row, timestamp]] })
        .mockResolvedValueOnce({ rows: [["admin", "special"]] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [[user.id, "admin", "special"]] })
        .mockResolvedValueOnce({ rows: [[user.id, timestamp]] });
      const dispatch = vi.fn(async () => {});
      await withCurrentUser(user, () =>
        saveBriefRecord(
          { ...input, summary: "Yeni xülasə.", briefId: existing.id, isNew: false, uploads: [] },
          { sendIndexing: dispatch },
        ),
      );
      const [query, params] = mocks.query.mock.calls.find(([sql]) =>
        String(sql).startsWith('update "daily_briefs"'),
      )!;
      expect(query).toContain('"summary" =');
      expect(params).toContain("Yeni xülasə.");
      expect(params).toContain(existing.title);
      expect(params).toContain(existing.body);
      expect(params).toContain(existing.bodyRich);
      expect(query).not.toContain('"index_status" =');
      expect(query).not.toContain('"index_progress" =');
      expect(dispatch).not.toHaveBeenCalled();
      expect(
        mocks.query.mock.calls.some(([sql]) =>
          /(?:update|delete from|insert into) "chunks"/.test(String(sql)),
        ),
      ).toBe(false);
    },
  );
  it("rejects inactive users before issuing any signed URL", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
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
  it("checks active user again inside the save transaction after storage preparation", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [["admin", "special"]] })
      .mockResolvedValueOnce({ rows: [] });
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
