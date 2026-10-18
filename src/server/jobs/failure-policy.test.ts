import { describe, expect, it } from "vitest";

import { GeminiQuotaExceededError } from "../ai/gemini-gateway";
import { isTemporaryWorkerFailure } from "./failure-policy";

describe("background worker retry policy", () => {
  it("retries provider 5xx and transient network failures", () => {
    expect(isTemporaryWorkerFailure({ statusCode: 503 })).toBe(true);
    expect(isTemporaryWorkerFailure({ cause: { code: "ECONNRESET" } })).toBe(true);
    expect(isTemporaryWorkerFailure(new Error("fetch failed"))).toBe(true);
  });

  it("does not retry quota exhaustion, validation, or other permanent failures", () => {
    expect(isTemporaryWorkerFailure(new GeminiQuotaExceededError("GEMINI_EMBED_MODEL"))).toBe(
      false,
    );
    expect(isTemporaryWorkerFailure({ statusCode: 429 })).toBe(false);
    expect(isTemporaryWorkerFailure(new Error("invalid document signature"))).toBe(false);
  });
});
