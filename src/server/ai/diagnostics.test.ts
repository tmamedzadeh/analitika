import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiDiagnostic, withAiDiagnostics } from "./diagnostics";

afterEach(() => vi.restoreAllMocks());

describe("analytics AI diagnostic context", () => {
  it("logs timeout outcome and attempt without fabricating provider completion metadata", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    withAiDiagnostics(
      { requestId: "timeout-test", startedAt: Date.now(), stage: "generation" },
      () =>
        logAiDiagnostic({
          event: "deadline",
          model: "gemini-3.8-flash",
          generationAttempt: 2,
          errorCategory: "timeout",
          timeoutScope: "overall",
          outcome: "failed",
          ...{
            prompt: "private prompt",
            answer: "private answer",
            apiKey: "secret",
            source: "classified",
          },
        }),
    );
    const event = JSON.parse(String(error.mock.calls[0]?.[0]).replace("[analytics-ai] ", ""));
    expect(event).toMatchObject({
      requestId: "timeout-test",
      stage: "generation",
      model: "gemini-3.8-flash",
      generationAttempt: 2,
      errorCategory: "timeout",
      timeoutScope: "overall",
      outcome: "failed",
      providerStatus: null,
    });
    expect(event).not.toHaveProperty("finishReason");
    for (const field of ["prompt", "answer", "apiKey", "source"])
      expect(event).not.toHaveProperty(field);
  });
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
