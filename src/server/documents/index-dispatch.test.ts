// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCreatedDocument } from "./index-dispatch";
const documentId = "00000000-0000-4000-8000-000000000001";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("bounded existing text event dispatch", () => {
  it("uses the existing event and creation ID without sending a photo job", async () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "synthetic");
    const fetch = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({ status: 200, ids: ["synthetic"] }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await dispatchCreatedDocument(documentId)).toBe(false);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body[0]).toMatchObject({
      name: "document/indexing.requested",
      data: { documentId },
      id: `document-created:${documentId}`,
    });
  });
  it("aborts a stalled event request and completes bounded SDK retries", async () => {
    vi.useFakeTimers();
    vi.stubEnv("INNGEST_EVENT_KEY", "synthetic");
    const fetch = vi.fn(
      (_url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) reject(new Error("Synthetic aborted event"));
          else
            signal?.addEventListener("abort", () => reject(new Error("Synthetic aborted event")), {
              once: true,
            });
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = dispatchCreatedDocument(documentId);
    await vi.advanceTimersByTimeAsync(4500);
    expect(await result).toBe(true);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(5);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
