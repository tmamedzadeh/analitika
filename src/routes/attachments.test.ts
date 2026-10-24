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
  it.each([false, true])(
    "serves authorized derivative or unchanged original (original=%s)",
    async (original) => {
      const derivative = { key: "display-key", mime: "image/webp", size: 3, width: 1, height: 1 };
      mocks.query.mockResolvedValueOnce({ rows: [[user.id]] }).mockResolvedValueOnce({
        rows: [
          [
            "original-key",
            { width: 1, height: 1, sha256: "digest", derivative },
            "image/png",
            "photo.png",
            3,
          ],
        ],
      });
      const file = await withCurrentUser(user, () =>
        readAuthorizedAttachment("document", id, id, original),
      );
      expect(file?.key).toBe(original ? "original-key" : "display-key");
      expect(file?.mime).toBe(original ? "image/png" : "image/webp");
      expect(mocks.object).toHaveBeenCalledWith(original ? "original-key" : "display-key");
    },
  );
  it("falls back to the authorized original when its derivative is unavailable", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[user.id]] }).mockResolvedValueOnce({
      rows: [
        [
          "original-key",
          {
            width: 1,
            height: 1,
            sha256: "digest",
            derivative: { key: "missing", mime: "image/webp", size: 3, width: 1, height: 1 },
          },
          "image/png",
          "photo.png",
          3,
        ],
      ],
    });
    mocks.object.mockRejectedValueOnce(new Error("Synthetic missing derivative"));
    const file = await withCurrentUser(user, () => readAuthorizedAttachment("brief", id, id));
    expect(file?.key).toBe("original-key");
    expect(mocks.object).toHaveBeenCalledTimes(2);
  });
  it.each(["document", "brief"])(
    "keeps live user/parent locks while reading %s bytes",
    async (kind) => {
      mocks.query
        .mockResolvedValueOnce({ rows: [[user.id]] })
        .mockResolvedValueOnce({ rows: [["synthetic-key", null, "image/png", "invented.png", 3]] });
      const result = await withCurrentUser(user, () => readAuthorizedAttachment(kind, id, id));
      expect(Array.from(new Uint8Array(result!.body))).toEqual([1, 2, 3]);
      expect(mocks.query.mock.calls.every(([sql]) => String(sql).includes("for share"))).toBe(true);
      const sql = mocks.query.mock.calls[1]![0] as string;
      if (kind === "document") expect(sql).toContain('"documents"."classification"');
      else expect(sql).not.toContain('"daily_briefs"."classification"');
      expect(sql).toContain('"app_users"."active"');
    },
  );
  it("does not read private storage when the classified parent is unavailable", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[user.id]] }).mockResolvedValueOnce({ rows: [] });
    expect(await withCurrentUser(user, () => readAuthorizedAttachment("brief", id, id))).toBeNull();
    expect(mocks.object).not.toHaveBeenCalled();
  });
});
