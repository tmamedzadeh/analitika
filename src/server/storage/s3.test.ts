// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "./s3";
import { readStorageBytes } from "./operations";
beforeEach(() => {
  for (const key of ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
    vi.stubEnv(key, "synthetic");
  vi.stubEnv("S3_ENDPOINT", "https://synthetic.invalid");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("real adapter operation abort propagation", () => {
  it.each(["get", "put", "delete"])(
    "aborts a stalled %s using its SDK AbortSignal",
    async (operation) => {
      vi.useFakeTimers();
      const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(
        (...args: unknown[]) =>
          new Promise((_resolve, reject) => {
            const options = args[1] as { abortSignal: AbortSignal };
            options.abortSignal.addEventListener(
              "abort",
              () => reject(new Error("Synthetic transport aborted")),
              { once: true },
            );
          }) as never,
      );
      const storage = new S3Storage();
      try {
        const result =
          operation === "get"
            ? storage.getObjectStream("synthetic", { timeoutMs: 20 })
            : operation === "put"
              ? storage.put(
                  { key: "synthetic", body: new Uint8Array([1]), contentType: "image/png" },
                  { timeoutMs: 20 },
                )
              : storage.delete("synthetic", { timeoutMs: 20 });
        const assertion = expect(result).rejects.toMatchObject({ code: "timeout" });
        await vi.advanceTimersByTimeAsync(21);
        await assertion;
        expect(send).toHaveBeenCalledOnce();
        expect((send.mock.calls[0]![1] as { abortSignal: AbortSignal }).abortSignal.aborted).toBe(
          true,
        );
      } finally {
        storage.close();
      }
    },
  );
  it("keeps the GET deadline after headers until the stream has been consumed", async () => {
    const cancel = vi.fn();
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: { transformToWebStream: () => new ReadableStream({ cancel }) },
    } as never);
    const storage = new S3Storage();
    try {
      const object = await storage.getObjectStream("synthetic", { timeoutMs: 20 });
      await expect(readStorageBytes(object.body, 1)).rejects.toMatchObject({ code: "timeout" });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      storage.close();
    }
  });
});
