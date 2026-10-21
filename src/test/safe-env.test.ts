import { describe, expect, it } from "vitest";

import { isolateTestEnvironment } from "./safe-env";

describe("test environment isolation", () => {
  it("removes external credentials and database URLs while retaining model settings", () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: "postgresql://placeholder.invalid/db",
      DATABASE_URL_MIGRATE: "postgresql://placeholder.invalid/db",
      ANALYTICS_EVAL_DATABASE_URL: "postgresql://placeholder.invalid/db",
      PROVIDER_API_KEY: "placeholder",
      SUPABASE_ACCESS_TOKEN: "placeholder",
      AWS_ACCESS_KEY_ID: "placeholder",
      AWS_SECRET_ACCESS_KEY: "placeholder",
      STRIPE_SECRET_KEY: "placeholder",
      AI_CHAT_MODEL: "gemini-test-model",
    };

    isolateTestEnvironment(env);

    expect(env).toMatchObject({ NODE_ENV: "test", AI_CHAT_MODEL: "gemini-test-model" });
    expect(env["DATABASE_URL"]).toBeUndefined();
    expect(env["DATABASE_URL_MIGRATE"]).toBeUndefined();
    expect(env["ANALYTICS_EVAL_DATABASE_URL"]).toBeUndefined();
    expect(env["PROVIDER_API_KEY"]).toBeUndefined();
    expect(env["SUPABASE_ACCESS_TOKEN"]).toBeUndefined();
    expect(env["AWS_ACCESS_KEY_ID"]).toBeUndefined();
    expect(env["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
    expect(env["STRIPE_SECRET_KEY"]).toBeUndefined();
  });
});
