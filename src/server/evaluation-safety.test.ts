import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requireProjectEvaluationDatabase,
  requireSyntheticEvaluationDatabase,
} from "./evaluation-safety";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("evaluation database guard", () => {
  it("refuses to override the configured database with a separate URL", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://project.invalid/postgres");
    vi.stubEnv("ANALYTICS_EVAL_DATABASE_URL", "postgresql://localhost/analitika_eval_synthetic");
    expect(() => requireProjectEvaluationDatabase()).toThrow(/separate evaluation databases/u);
  });

  it("allows the ordinary configured project DB without mutating it", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://project.invalid/postgres");
    vi.stubEnv("ANALYTICS_EVAL_DATABASE_URL", "");
    requireProjectEvaluationDatabase();
    expect(process.env["DATABASE_URL"]).toBe("postgresql://project.invalid/postgres");
  });

  it("does not permit the retired fixture-only evaluation mode", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://project.invalid/postgres");
    expect(() => requireSyntheticEvaluationDatabase()).toThrow(/not supported/u);
    expect(process.env["DATABASE_URL"]).toBe("postgresql://project.invalid/postgres");
  });

  it("requires the configured application database", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("ANALYTICS_EVAL_DATABASE_URL", "");
    expect(() => requireProjectEvaluationDatabase()).toThrow(/project database/u);
  });
});
