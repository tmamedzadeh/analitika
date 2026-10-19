import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppConfig } from "./config";
import { serverEnvSchema } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("AI model configuration", () => {
  it("requires the chat model but allows the light fallback to be omitted", () => {
    vi.stubEnv("AI_CHAT_MODEL", "gemini-main-test");
    vi.stubEnv("AI_LIGHT_MODEL", "");
    vi.stubEnv("GEMINI_EMBED_MODEL", "gemini-embedding-001");

    expect(getAppConfig()).toMatchObject({
      analyticsModel: "gemini-main-test",
      osintModel: "gemini-main-test",
      lightModel: undefined,
    });
  });

  it("reads the generic names and ignores legacy Gemini chat/light variables", () => {
    const env = serverEnvSchema.parse({
      AI_CHAT_MODEL: "generic-chat",
      AI_LIGHT_MODEL: "generic-light",
      GEMINI_CHAT_MODEL: "legacy-chat",
      GEMINI_LIGHT_MODEL: "legacy-light",
    });

    expect(env.AI_CHAT_MODEL).toBe("generic-chat");
    expect(env.AI_LIGHT_MODEL).toBe("generic-light");
    expect("GEMINI_CHAT_MODEL" in env).toBe(false);
    expect("GEMINI_LIGHT_MODEL" in env).toBe(false);
  });

  it("still requires a chat model", () => {
    vi.stubEnv("AI_CHAT_MODEL", "");
    vi.stubEnv("GEMINI_EMBED_MODEL", "gemini-embedding-001");

    expect(() => getAppConfig()).toThrow("Missing required environment variable: AI_CHAT_MODEL");
  });
});
