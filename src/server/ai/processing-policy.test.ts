import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertExternalAiClassification,
  isExternalAiClassificationAllowed,
} from "./processing-policy";

afterEach(() => vi.unstubAllEnvs());
describe("external AI classification policy", () => {
  it("fails closed for every classified level and unknown values by default", () => {
    vi.stubEnv("AI_EXTERNAL_ALLOWED_CLASSIFICATIONS", "open");
    vi.stubEnv("AI_EXTERNAL_POLICY_REFERENCE", "");
    expect(isExternalAiClassificationAllowed("open")).toBe(true);
    for (const level of ["secret", "top_secret", "special", "unknown"]) {
      expect(() => assertExternalAiClassification(level)).toThrow(/not authorized/);
    }
  });
  it("requires both an explicit allowlist and a policy reference for classified content", () => {
    vi.stubEnv("AI_EXTERNAL_ALLOWED_CLASSIFICATIONS", "open,secret");
    vi.stubEnv("AI_EXTERNAL_POLICY_REFERENCE", "");
    expect(isExternalAiClassificationAllowed("secret")).toBe(false);
    vi.stubEnv("AI_EXTERNAL_POLICY_REFERENCE", "approved-policy-test-reference");
    expect(isExternalAiClassificationAllowed("secret")).toBe(true);
    expect(isExternalAiClassificationAllowed("special")).toBe(false);
  });
});
