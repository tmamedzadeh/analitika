import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeminiProviders, GeminiLLMProvider } from "./gemini";
import {
  clearGeminiModelCooldowns,
  GEMINI_QUOTA_COOLDOWN_MS,
  isGeminiModelCoolingDown,
  withGeminiStream,
} from "./gemini-gateway";

const chat = "gemini-3.8-flash",
  light = "gemini-3.5-flash-lite",
  backup = "gemini-3.1-flash-lite";
const ok = () =>
  Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: "answer" }] }, finishReason: "STOP" }],
  });
const failure = (status: number, quota = "") =>
  Response.json(
    {
      error: {
        code: status,
        message: status === 402 ? "Prepaid credits depleted" : "Synthetic provider failure",
        details: quota ? [{ violations: [{ quotaId: quota }] }] : [],
      },
    },
    { status },
  );
const modelFrom = (url: unknown) => String(url).match(/models\/([^:]+)/)?.[1];

beforeEach(() => {
  clearGeminiModelCooldowns();
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "synthetic");
  vi.stubEnv("AI_CHAT_MODEL", chat);
  vi.stubEnv("AI_LIGHT_MODEL", light);
  vi.stubEnv("AI_BACKUP_MODEL", backup);
  vi.stubEnv("GEMINI_EMBED_MODEL", "gemini-embedding-2");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  clearGeminiModelCooldowns();
});

describe("three-level Gemini routing", () => {
  it("falls chat → light → backup immediately on daily quotas and keeps corrective calls on backup", async () => {
    const fetch = vi.fn(async (url: unknown) =>
      modelFrom(url) === backup ? ok() : failure(429, "GenerateRequestsPerDayPerProjectPerModel"),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = createGeminiProviders().analytics;
    const onFallback = vi.fn();
    expect((await provider.generateTextWithMetadata({ prompt: "test", onFallback })).model).toBe(
      backup,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onFallback.mock.calls.map(([event]) => event.toModel)).toEqual([light, backup]);
    expect(onFallback.mock.calls[1]?.[0]).toMatchObject({ backup: true, reason: "quota" });
    await provider.generateTextWithMetadata({ prompt: "corrective" });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(modelFrom(fetch.mock.calls[3]?.[0])).toBe(backup);
  });
  it("routes light to backup while chat keeps its priority", async () => {
    const fetch = vi.fn(async (url: unknown) =>
      modelFrom(url) === light ? failure(429, "RequestsPerDay") : ok(),
    );
    vi.stubGlobal("fetch", fetch);
    const providers = createGeminiProviders();
    await providers.light.generateText({ prompt: "light" });
    expect(fetch.mock.calls.map(([url]) => modelFrom(url))).toEqual([light, backup]);
    expect((await providers.analytics.generateTextWithMetadata({ prompt: "analysis" })).model).toBe(
      chat,
    );
  });
  it("reserves light for Analytics when chat is cooling down, then recovers original priorities", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (url: unknown) =>
      modelFrom(url) === chat ? failure(429, "InputTokensPerDay") : ok(),
    );
    vi.stubGlobal("fetch", fetch);
    const providers = createGeminiProviders();
    await providers.analytics.generateText({ prompt: "test" });
    expect(isGeminiModelCoolingDown(chat)).toBe(true);
    await providers.light.generateText({ prompt: "light" });
    expect(fetch.mock.calls.map(([url]) => modelFrom(url))).toEqual([chat, light, backup]);
    await vi.advanceTimersByTimeAsync(GEMINI_QUOTA_COOLDOWN_MS + 1);
    fetch.mockImplementation(async () => ok());
    await providers.light.generateText({ prompt: "light" });
    expect((await providers.analytics.generateTextWithMetadata({ prompt: "test" })).model).toBe(
      chat,
    );
    expect(fetch.mock.calls.slice(-2).map(([url]) => modelFrom(url))).toEqual([light, chat]);
  });
  it("keeps two levels when backup is absent and stays silent on normal light calls", async () => {
    vi.stubEnv("AI_BACKUP_MODEL", "");
    const fetch = vi.fn(async (url: unknown) =>
      modelFrom(url) === chat ? failure(429, "RequestsPerDay") : ok(),
    );
    vi.stubGlobal("fetch", fetch);
    const providers = createGeminiProviders(),
      onFallback = vi.fn();
    await providers.light.generateText({ prompt: "test", onFallback });
    expect(onFallback).not.toHaveBeenCalled();
    expect((await providers.analytics.generateTextWithMetadata({ prompt: "test" })).model).toBe(
      light,
    );
    expect(fetch.mock.calls.map(([url]) => modelFrom(url))).toEqual([light, chat, light]);
  });
  it.each([502, 503, 504])(
    "bounds retries and fallback if all models fail with %s",
    async (status) => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => failure(status));
      vi.stubGlobal("fetch", fetch);
      const onFallback = vi.fn();
      const rejected = expect(
        createGeminiProviders().analytics.generateText({
          prompt: "test",
          maxAttempts: 2,
          onFallback,
        }),
      ).rejects.toMatchObject({ statusCode: status });
      await vi.runAllTimersAsync();
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(6);
      expect(onFallback).toHaveBeenCalledTimes(2);
      expect(onFallback.mock.calls.every(([event]) => event.reason === "unavailable")).toBe(true);
    },
  );
  it.each([400, 401, 402, 403, 404, 422])(
    "does not model-fallback on auth, billing or invalid requests (%s)",
    async (status) => {
      const fetch = vi.fn(async () => failure(status));
      vi.stubGlobal("fetch", fetch);
      const onFallback = vi.fn();
      await expect(
        createGeminiProviders().analytics.generateText({ prompt: "test", onFallback }),
      ).rejects.toBeDefined();
      expect(fetch).toHaveBeenCalledOnce();
      expect(onFallback).not.toHaveBeenCalled();
    },
  );
  it("bounds unknown 429 retries before fallback", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (url: unknown) => (modelFrom(url) === chat ? failure(429) : ok()));
    vi.stubGlobal("fetch", fetch);
    const pending = createGeminiProviders().analytics.generateTextWithMetadata({
      prompt: "test",
      maxAttempts: 2,
    });
    await vi.runAllTimersAsync();
    expect((await pending).model).toBe(light);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("honors remaining deadline instead of sleeping beyond it for RPM Retry-After", async () => {
    const fetch = vi.fn(async (url: unknown) =>
      modelFrom(url) !== chat
        ? ok()
        : Response.json(
            { error: { message: "rate limit", details: [{ quotaId: "RequestsPerMinute" }] } },
            { status: 429, headers: { "retry-after": "30" } },
          ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await createGeminiProviders().analytics.generateTextWithMetadata({
      prompt: "test",
      deadlineAt: Date.now() + 10_000,
    });
    expect(result.model).toBe(light);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(isGeminiModelCoolingDown(chat)).toBe(false);
  });
  it("stops before any provider call on abort and never restarts a partially emitted stream", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      new GeminiLLMProvider(chat, "AI_CHAT_MODEL", light, backup).generateText({
        prompt: "test",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      new GeminiLLMProvider(chat, "AI_CHAT_MODEL", light, backup).generateText({
        prompt: "test",
        deadlineAt: Date.now() - 1,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).not.toHaveBeenCalled();
    const operation = vi.fn(async () =>
      (async function* () {
        yield "partial";
        throw Object.assign(new Error("unavailable"), { statusCode: 503 });
      })(),
    );
    const received: string[] = [];
    await expect(async () => {
      for await (const value of withGeminiStream("AI_CHAT_MODEL", operation)) received.push(value);
    }).rejects.toMatchObject({ statusCode: 503 });
    expect(received).toEqual(["partial"]);
    expect(operation).toHaveBeenCalledOnce();
  });
});
