import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiDiagnostic, withAiDiagnostics } from "./diagnostics";

afterEach(() => vi.restoreAllMocks());

describe("analytics AI diagnostic context", () => {
  it("keeps concurrent request IDs and nested stages separate and logs only selected fields", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await Promise.all(
      ["request-a", "request-b"].map((requestId) =>
        withAiDiagnostics({ requestId, startedAt: Date.now(), stage: "retrieval" }, async () => {
          await Promise.resolve();
          withAiDiagnostics({ stage: "query_embedding" }, () =>
            logAiDiagnostic({
              event: "success",
              model: requestId + "-model",
              attempt: 1,
              providerStatus: 200,
              ...{
                prompt: "private prompt",
                response: "private response",
                tokens: "private tokens",
              },
            }),
          );
        }),
      ),
    );

    const events = info.mock.calls.map(([message]) =>
      JSON.parse(String(message).replace("[analytics-ai] ", "")),
    );
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.model).toBe(event.requestId + "-model");
      expect(event.stage).toBe("query_embedding");
      expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(events)).not.toContain("private");
    expect(logAiDiagnostic({ event: "success" })).toBe(false);
  });
});
