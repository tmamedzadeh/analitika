import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider, GeminiLLMProvider } from "./gemini";
import { withAiDiagnostics } from "./diagnostics";

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "synthetic-test-key");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Gemini SDK and gateway retry budget", () => {
  it("reports the model that actually completed after quota fallback", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async (url: unknown) =>
      String(url).includes("gemini-3.8-flash")
        ? Response.json(
            { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic quota" } },
            { status: 429 },
          )
        : Response.json({
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Synthetic answer" }] },
                finishReason: "STOP",
              },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await withAiDiagnostics(
      { requestId: "quota-test", startedAt: Date.now(), stage: "generation", generationAttempt: 1 },
      () =>
        new GeminiLLMProvider(
          "gemini-3.8-flash",
          "AI_CHAT_MODEL",
          "gemini-3.5-flash-lite",
        ).generateTextWithMetadata({ prompt: "Synthetic prompt", maxAttempts: 1 }),
    );
    expect(result).toEqual({
      text: "Synthetic answer",
      finishReason: "stop",
      model: "gemini-3.5-flash-lite",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const logs = [info.mock.calls, warn.mock.calls, error.mock.calls].flat().join(" ");
    expect(logs).toContain('"requestId":"quota-test"');
    expect(logs).toContain('"event":"fallback"');
    expect(logs).toContain('"model":"gemini-3.5-flash-lite"');
    expect(logs).toContain('"providerStatus":429');
    expect(logs).toContain('"errorCategory":"quota"');
    for (const secret of [
      "Synthetic prompt",
      "Synthetic answer",
      "synthetic-test-key",
      "RESOURCE_EXHAUSTED",
    ])
      expect(logs).not.toContain(secret);
  });

  it("logs bounded SDK 503 attempts without falling back or exposing provider data", async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () =>
      Response.json(
        {
          error: { code: 503, status: "UNAVAILABLE", message: "private response and credentials" },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = withAiDiagnostics(
      { requestId: "503-test", startedAt: Date.now(), stage: "generation", generationAttempt: 2 },
      () =>
        new GeminiLLMProvider("gemini-main", "AI_CHAT_MODEL", "gemini-light").generateText({
          prompt: "private prompt",
          maxAttempts: 2,
        }),
    );
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 503 });
    await vi.runAllTimersAsync();
    await rejected;

    expect(fetch).toHaveBeenCalledTimes(2);
    const logs = [info.mock.calls, warn.mock.calls, error.mock.calls].flat().join(" ");
    expect(logs).toContain('"requestId":"503-test"');
    expect(logs).toContain('"attempt":2');
    expect(logs).toContain('"generationAttempt":2');
    expect(logs).toContain('"providerStatus":503');
    expect(logs).toContain('"errorCategory":"provider_unavailable"');
    expect(logs).not.toContain('"event":"fallback"');
    for (const secret of [
      "private prompt",
      "private response and credentials",
      "synthetic-test-key",
    ])
      expect(logs).not.toContain(secret);
  });
  it("makes exactly one HTTP attempt for a one-attempt embedding quota failure", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic quota exhaustion" },
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      new GeminiEmbeddingProvider("gemini-embedding-2").embedQuery("synthetic query", {
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({ name: "GeminiQuotaExceededError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one HTTP attempt for a one-attempt generation quota failure", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic quota exhaustion" },
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      new GeminiLLMProvider("gemini-3.8-flash").generateText({
        prompt: "Synthetic prompt",
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({ name: "GeminiQuotaExceededError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry or fall back after an aborted request", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const pending = new GeminiLLMProvider(
      "gemini-3.8-flash",
      "AI_CHAT_MODEL",
      "gemini-3.5-flash-lite",
    ).generateText({ prompt: "Synthetic prompt", signal: controller.signal });
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort(new DOMException("Synthetic cancellation", "AbortError"));
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("includes Retry-After waiting inside the total generation timeout", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { code: 429, message: "Synthetic quota" } },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      new GeminiLLMProvider("gemini-3.8-flash").generateText({
        prompt: "Synthetic prompt",
        timeoutMs: 50,
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
