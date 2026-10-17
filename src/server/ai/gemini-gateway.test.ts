import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GeminiQuotaExceededError,
  GeminiRequestBudget,
  GeminiRequestBudgetExceededError,
  withGeminiRequest,
} from "./gemini-gateway";

afterEach(() => vi.useRealTimers());

describe("Gemini request gateway", () => {
  it("keeps concurrent requests at or below three", async () => {
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 9 }, () =>
        withGeminiRequest("GEMINI_CHAT_MODEL", async () => {
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
    const request = withGeminiRequest("GEMINI_LIGHT_MODEL", async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("private provider detail"), {
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

  it("counts retries against the per-run call budget", async () => {
    const budget = new GeminiRequestBudget(1);
    await expect(
      withGeminiRequest(
        "GEMINI_LIGHT_MODEL",
        async () => {
          throw Object.assign(new Error("quota"), { statusCode: 429 });
        },
        budget,
      ),
    ).rejects.toBeInstanceOf(GeminiRequestBudgetExceededError);
    expect(budget.calls).toBe(1);
  });

  it("wraps exhausted quota without exposing the provider message", async () => {
    vi.useFakeTimers();
    const request = withGeminiRequest("GEMINI_CHAT_MODEL", async () => {
      throw Object.assign(new Error("private provider detail"), { statusCode: 429 });
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: "GeminiQuotaExceededError",
      quotaKey: "GEMINI_CHAT_MODEL",
      message: expect.not.stringContaining("private"),
    });
    await vi.runAllTimersAsync();
    await rejection;
  });

  it("provides a typed quota error for UI-safe handling", () => {
    const error = new GeminiQuotaExceededError("GEMINI_EMBED_MODEL");
    expect(error.quotaKey).toBe("GEMINI_EMBED_MODEL");
    expect(error.message).not.toContain("API key");
  });
});
