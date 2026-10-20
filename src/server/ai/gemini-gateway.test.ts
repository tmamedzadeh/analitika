import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GeminiQuotaExceededError,
  isGeminiQuotaError,
  withGeminiQuotaFallback,
  withGeminiQuotaFallbackStream,
  withGeminiRequest,
} from "./gemini-gateway";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Gemini request gateway", () => {
  it("keeps concurrent provider requests at or below three", async () => {
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 9 }, () =>
        withGeminiRequest("AI_CHAT_MODEL", async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    expect(maximum).toBe(3);
  });

  it("waits for Retry-After before retrying a 429", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const request = withGeminiRequest("AI_LIGHT_MODEL", async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("sensitive provider details"), {
          statusCode: 429,
          responseHeaders: { "retry-after": "2" },
        });
      }
      return "ok";
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("stops after three quota attempts without exposing provider text", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const request = withGeminiRequest("AI_CHAT_MODEL", async () => {
      calls += 1;
      throw Object.assign(new Error("sensitive provider details"), { statusCode: 429 });
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: "GeminiQuotaExceededError",
      quotaKey: "AI_CHAT_MODEL",
      message: expect.not.stringContaining("sensitive"),
    });

    await vi.runAllTimersAsync();
    await rejection;
    expect(calls).toBe(3);
  });

  it("provides a typed quota error for UI-safe handling", () => {
    const error = new GeminiQuotaExceededError("GEMINI_EMBED_MODEL");
    expect(error.quotaKey).toBe("GEMINI_EMBED_MODEL");
    expect(error.message).not.toContain("API key");
  });

  it("stops immediately for terminal free-tier exhaustion", async () => {
    let calls = 0;
    await expect(
      withGeminiRequest("AI_CHAT_MODEL", async () => {
        calls += 1;
        throw Object.assign(new Error("Gemini API error"), {
          statusCode: 403,
          responseBody: JSON.stringify({ code: "AllocationQuota.FreeTierOnly" }),
        });
      }),
    ).rejects.toMatchObject({
      limitKind: "free-tier",
      terminal: true,
      quotaKey: "AI_CHAT_MODEL",
    });
    expect(calls).toBe(1);
  });

  it("recognizes depleted prepaid credits and avoids retrying the same model", async () => {
    let calls = 0;
    const error = Object.assign(new Error("Google API request failed"), {
      statusCode: 402,
      responseBody: JSON.stringify({
        error: { code: 402, status: "PAYMENT_REQUIRED", message: "Prepaid credits depleted" },
      }),
    });
    expect(isGeminiQuotaError(error)).toBe(true);
    await expect(
      withGeminiRequest("AI_CHAT_MODEL", async () => {
        calls += 1;
        throw error;
      }),
    ).rejects.toMatchObject({ quotaKey: "AI_CHAT_MODEL", statusCode: 402 });
    expect(calls).toBe(1);
  });

  it("does not classify authentication failures as quota exhaustion", () => {
    const error = Object.assign(new Error("API key is not authorized"), {
      statusCode: 401,
      responseBody: JSON.stringify({
        error: { code: 401, status: "UNAUTHENTICATED", message: "quota exceeded" },
      }),
    });
    expect(isGeminiQuotaError(error)).toBe(false);
  });

  it("uses one light-model call after primary quota exhaustion", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = vi.fn(async () => {
      throw new GeminiQuotaExceededError("AI_CHAT_MODEL", "per-minute");
    });
    const fallback = vi.fn(async () => "light result");

    await expect(
      withGeminiQuotaFallback("gemini-main", "gemini-light", primary, fallback),
    ).resolves.toBe("light result");
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("does not use fallback for unrelated errors", async () => {
    const primary = vi.fn(async () => {
      throw Object.assign(new Error("invalid request"), { statusCode: 400 });
    });
    const fallback = vi.fn(async () => "light result");

    await expect(
      withGeminiQuotaFallback("gemini-main", "gemini-light", primary, fallback),
    ).rejects.toThrow("invalid request");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("propagates a failed light-model request without another fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = vi.fn(async () => {
      throw new GeminiQuotaExceededError("AI_CHAT_MODEL", "per-day");
    });
    const fallback = vi.fn(async () => {
      throw new GeminiQuotaExceededError("AI_LIGHT_MODEL", "per-minute");
    });

    await expect(
      withGeminiQuotaFallback("gemini-main", "gemini-light", primary, fallback),
    ).rejects.toMatchObject({ quotaKey: "AI_LIGHT_MODEL" });
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("falls back for a stream quota error only before emitting output", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const quotaBeforeOutput: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw new GeminiQuotaExceededError("AI_CHAT_MODEL", "per-minute");
        },
      }),
    };
    const fallback = vi.fn(async () =>
      (async function* () {
        yield "light";
      })(),
    );
    const output: string[] = [];
    for await (const value of withGeminiQuotaFallbackStream(
      quotaBeforeOutput,
      "gemini-main",
      "gemini-light",
      fallback,
    )) {
      output.push(value);
    }
    expect(output).toEqual(["light"]);
    expect(fallback).toHaveBeenCalledOnce();

    async function* partialThenQuota() {
      yield "partial";
      throw new GeminiQuotaExceededError("AI_CHAT_MODEL", "per-minute");
    }
    const unusedFallback = vi.fn(async () =>
      (async function* () {
        yield "unused";
      })(),
    );
    const partial: string[] = [];
    await expect(async () => {
      for await (const value of withGeminiQuotaFallbackStream(
        partialThenQuota(),
        "gemini-main",
        "gemini-light",
        unusedFallback,
      )) {
        partial.push(value);
      }
    }).rejects.toBeInstanceOf(GeminiQuotaExceededError);
    expect(partial).toEqual(["partial"]);
    expect(unusedFallback).not.toHaveBeenCalled();
  });
});
