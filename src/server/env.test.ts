import { describe, expect, it } from "vitest";

import { serverEnvSchema } from "./env";

describe("server environment defaults", () => {
  it("keeps selective context expansion OFF unless explicitly enabled", () => {
    expect(serverEnvSchema.parse({}).ENABLE_CONTEXT_EXPANSION).toBe("false");
    expect(
      serverEnvSchema.parse({ ENABLE_CONTEXT_EXPANSION: "true" }).ENABLE_CONTEXT_EXPANSION,
    ).toBe("true");
    expect(serverEnvSchema.safeParse({ ENABLE_CONTEXT_EXPANSION: "yes" }).success).toBe(false);
  });
  it("defaults the database connection pool to three and accepts an override", () => {
    expect(serverEnvSchema.parse({}).DATABASE_POOL_MAX).toBe(3);
    expect(serverEnvSchema.parse({ DATABASE_POOL_MAX: "5" }).DATABASE_POOL_MAX).toBe(5);
  });

  it("rejects invalid database pool sizes", () => {
    expect(serverEnvSchema.safeParse({ DATABASE_POOL_MAX: "0" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ DATABASE_POOL_MAX: "51" }).success).toBe(false);
  });
});
