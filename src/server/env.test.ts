import { describe, expect, it } from "vitest";

import { serverEnvSchema } from "./env";

describe("server environment defaults", () => {
  it("defaults the database connection pool to three and accepts an override", () => {
    expect(serverEnvSchema.parse({}).DATABASE_POOL_MAX).toBe(3);
    expect(serverEnvSchema.parse({ DATABASE_POOL_MAX: "5" }).DATABASE_POOL_MAX).toBe(5);
  });

  it("rejects invalid database pool sizes", () => {
    expect(serverEnvSchema.safeParse({ DATABASE_POOL_MAX: "0" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ DATABASE_POOL_MAX: "51" }).success).toBe(false);
  });
});
