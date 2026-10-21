import { afterEach, describe, expect, it, vi } from "vitest";

import { parseMode } from "../../scripts/seed-demo";

describe("demo seed protected mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("cannot run destructive reset against ordinary development project settings", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DATABASE_URL", "postgresql://configured-project.invalid/postgres");
    vi.stubEnv("DATABASE_URL_MIGRATE", "");
    expect(() => parseMode(["--reset-and-seed"])).toThrow(
      /disabled for the configured project database/u,
    );
    expect(parseMode(["--dry-run"])).toBe("dry-run");
  });
});
