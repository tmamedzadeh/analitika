// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  readStorageBytes,
  operationScope,
  imageErrorMessage,
  ImageOperationError,
} from "./operations";

describe("bounded storage operations", () => {
  it("cancels a stalled stream on the whole-operation deadline", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    await expect(readStorageBytes(body, 10, { timeoutMs: 20 })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("propagates parent cancellation and releases timers", () => {
    const parent = new AbortController();
    const scope = operationScope({ signal: parent.signal });
    parent.abort();
    expect(scope.signal.aborted).toBe(true);
    scope.dispose();
  });
  it("rejects overflow and truncated bytes", async () => {
    for (const size of [1, 3]) {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(2));
          c.close();
        },
      });
      await expect(readStorageBytes(body, size)).rejects.toMatchObject({ code: "validation" });
    }
  });
  it("never exposes provider exceptions", () => {
    expect(imageErrorMessage(new Error("secret provider fetch error"))).not.toContain("fetch");
    expect(imageErrorMessage(new ImageOperationError("storage"))).toContain("yaddaşı");
  });
});
