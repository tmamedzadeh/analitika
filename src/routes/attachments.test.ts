// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import {
  readAuthorizedAttachment,
  attachmentResponse,
} from "./api.attachments.$kind.$parentId.$attachmentId";

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
let file: unknown[];
let revoked = false;
beforeEach(() => {
  mocks.query.mockReset();
  mocks.object.mockReset();
  revoked = false;
  file = ["original-key", null, "image/png", "synthetic.png", 3];
  mocks.query.mockImplementation(async (statement: string) => ({
    rows: revoked ? [] : statement.includes("inner join") ? [file] : [[user.id]],
  }));
  mocks.object.mockImplementation(
    async (_key: string, options?: { range?: { start: number; end: number } }) => {
      const size = options?.range ? options.range.end - options.range.start + 1 : Number(file[4]);
      const bytes = new Uint8Array(size);
      bytes.fill(7);
      return {
        size,
        body: new ReadableStream({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      };
    },
  );
});

describe("private authenticated attachments and bounded original delivery", () => {
  it.each([false, true])(
    "serves the optimized display or unchanged original (original=%s)",
    async (original) => {
      file[1] = {
        derivative: { key: "display-key", mime: "image/webp", size: 3, width: 1, height: 1 },
      };
      const result = await withCurrentUser(user, () =>
        readAuthorizedAttachment("document", id, id, original),
      );
      expect(result?.key).toBe(original ? "original-key" : "display-key");
      expect(result?.mime).toBe(original ? "image/png" : "image/webp");
      expect(new Uint8Array(result!.body)).toEqual(new Uint8Array([7, 7, 7]));
      expect(mocks.query).toHaveBeenCalledTimes(4);
    },
  );
  it("falls back to a missing optional derivative with the same ACL", async () => {
    file[1] = { derivative: { key: "missing", mime: "image/webp", size: 3 } };
    mocks.object.mockRejectedValueOnce(new Error("Synthetic missing derivative"));
    expect(
      (await withCurrentUser(user, () => readAuthorizedAttachment("brief", id, id)))?.key,
    ).toBe("original-key");
  });
  it.each(["document", "brief"])(
    "checks live %s ACL again after S3, without holding a transaction over I/O",
    async (kind) => {
      const original = mocks.object.getMockImplementation()!;
      mocks.object.mockImplementation(async (...args) => {
        const result = await original(...args);
        revoked = true;
        return result;
      });
      expect(await withCurrentUser(user, () => readAuthorizedAttachment(kind, id, id))).toBeNull();
      expect(mocks.query.mock.calls[1]![0]).toContain('"app_users"."active"');
      if (kind === "document")
        expect(mocks.query.mock.calls[1]![0]).toContain('"documents"."classification"');
    },
  );
  it("does not read storage for unavailable parents or unauthenticated users", async () => {
    revoked = true;
    expect(
      await withCurrentUser(user, () => readAuthorizedAttachment("document", id, id)),
    ).toBeNull();
    expect(mocks.object).not.toHaveBeenCalled();
    await expect(readAuthorizedAttachment("document", id, id)).rejects.toThrow();
  });
  it("delivers a 6MiB original in <=1MiB responses with private headers", async () => {
    file[4] = 6 * 1024 * 1024;
    const response = await withCurrentUser(user, () =>
      attachmentResponse(
        "document",
        id,
        id,
        new Request("https://synthetic.invalid/api/attachments/document/x/y?original=1", {
          headers: { range: "bytes=1048576-2097151" },
        }),
      ),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1048576-2097151/6291456");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(1024 * 1024);
    expect(mocks.object).toHaveBeenCalledWith(
      "original-key",
      expect.objectContaining({ range: { start: 1048576, end: 2097151 } }),
    );
  });
  it("rejects excessive, malformed and unsatisfiable ranges without S3 access", async () => {
    file[4] = 6 * 1024 * 1024;
    for (const range of ["bytes=0-2097151", "bytes=0-1,3-4", "bytes=99999999-999999999"]) {
      const response = await withCurrentUser(user, () =>
        attachmentResponse(
          "document",
          id,
          id,
          new Request("https://synthetic.invalid/api/attachments/document/x/y", {
            headers: { range },
          }),
        ),
      );
      expect(response.status).toBe(416);
    }
    const response = await withCurrentUser(user, () =>
      attachmentResponse(
        "document",
        id,
        id,
        new Request("https://synthetic.invalid/api/attachments/document/x/y"),
      ),
    );
    expect(response.status).toBe(413);
    expect(mocks.object).not.toHaveBeenCalled();
  });
});
