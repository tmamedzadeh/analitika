import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider, GeminiLLMProvider } from "./gemini";

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "synthetic-test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Gemini SDK and gateway retry budget", () => {
  it("reports the model that actually completed after quota fallback", async () => {
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
    const result = await new GeminiLLMProvider(
      "gemini-3.8-flash",
      "AI_CHAT_MODEL",
      "gemini-3.5-flash-lite",
    ).generateTextWithMetadata({ prompt: "Synthetic prompt", maxAttempts: 1 });
    expect(result).toEqual({
      text: "Synthetic answer",
      finishReason: "stop",
      model: "gemini-3.5-flash-lite",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
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
