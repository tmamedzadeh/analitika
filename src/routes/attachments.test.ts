import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { readAuthorizedAttachment } from "./api.attachments.$kind.$parentId.$attachmentId";

const mocks = vi.hoisted(() => ({ query: vi.fn(), object: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => ({ transaction: (read: (tx: unknown) => unknown) => read(drizzle(mocks.query)) }),
  };
});
vi.mock("@/server/storage/s3", () => ({ getStorage: () => ({ getObjectStream: mocks.object }) }));
const user: SessionUser = {
  id: "reader",
  username: "invented",
  role: "admin",
  clearance: "special",
  sessionId: "synthetic",
};
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.object.mockImplementation(async () => ({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
    size: 3,
  }));
});
describe("authorized buffered attachments", () => {
  it.each(["document", "brief"])(
    "keeps live user/parent locks while reading %s bytes",
    async (kind) => {
      mocks.query
        .mockResolvedValueOnce({ rows: [[user.id]] })
        .mockResolvedValueOnce({ rows: [["synthetic-key", "image/png", "invented.png", 3]] });
      const result = await withCurrentUser(user, () => readAuthorizedAttachment(kind, id, id));
      expect(Array.from(new Uint8Array(result!.body))).toEqual([1, 2, 3]);
      expect(mocks.query.mock.calls.every(([sql]) => String(sql).includes("for share"))).toBe(true);
      const sql = mocks.query.mock.calls[1]![0] as string;
      expect(sql).toContain(
        kind === "brief" ? '"daily_briefs"."classification"' : '"documents"."classification"',
      );
      expect(sql).toContain('"app_users"."clearance"');
    },
  );
  it("does not read private storage when the classified parent is unavailable", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[user.id]] }).mockResolvedValueOnce({ rows: [] });
    expect(await withCurrentUser(user, () => readAuthorizedAttachment("brief", id, id))).toBeNull();
    expect(mocks.object).not.toHaveBeenCalled();
  });
});
