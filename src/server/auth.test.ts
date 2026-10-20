import { describe, expect, it } from "vitest";

import {
  allowedClassifications,
  canAccessClassification,
  getCurrentUser,
  loginRateLimitKeys,
  loginAttemptDelay,
  requireAdmin,
  safeInternalRedirect,
  withCurrentUser,
  type SessionUser,
} from "./auth";
import { hashPassword, normalizeUsername, verifyPassword } from "./auth/password";

const user: SessionUser = {
  id: "user-1",
  username: "analyst",
  role: "user",
  clearance: "secret",
  sessionId: "session-1",
};

describe("account authentication helpers", () => {
  it("normalizes usernames consistently", () => {
    expect(normalizeUsername("  ＡNALYST ")).toBe("analyst");
  });

  it("hashes passwords with scrypt and verifies without storing the original", async () => {
    const password = "correct horse battery staple";
    const encoded = await hashPassword(password);
    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(password, encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
    await expect(verifyPassword(password, null)).resolves.toBe(false);
  });

  it("applies the full hierarchical classification matrix", () => {
    const levels = ["open", "secret", "top_secret", "special"] as const;
    for (const [clearanceIndex, clearance] of levels.entries()) {
      expect(allowedClassifications({ clearance })).toEqual(levels.slice(0, clearanceIndex + 1));
      for (const [classificationIndex, classification] of levels.entries()) {
        expect(canAccessClassification({ clearance }, classification)).toBe(
          classificationIndex <= clearanceIndex,
        );
      }
    }
    expect(canAccessClassification({ clearance: "open" }, "unknown")).toBe(false);
  });

  it("accepts only internal redirect targets", () => {
    expect(safeInternalRedirect("/senedler?sort=recent#first")).toBe("/senedler?sort=recent#first");
    expect(safeInternalRedirect("https://outside.example")).toBe("/");
    expect(safeInternalRedirect("//outside.example")).toBe("/");
    expect(safeInternalRedirect("/\\outside.example")).toBe("/");
  });

  it("limits both an account and a known client address without storing either value", () => {
    const first = new Request("https://app.example/login", {
      headers: { "x-real-ip": "192.0.2.4" },
    });
    const sameAccount = new Request("https://app.example/login", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    const sameAddress = new Request("https://app.example/login", {
      headers: { "x-real-ip": "192.0.2.4" },
    });
    const [loginIpKey, addressKey] = loginRateLimitKeys(first, "analyst");
    expect(loginIpKey).not.toBe(loginRateLimitKeys(sameAccount, "analyst")[0]);
    expect(addressKey).toBe(loginRateLimitKeys(sameAddress, "different-user")[1]);
    expect(loginIpKey).not.toContain("analyst");
    expect(addressKey).not.toContain("192.0.2.4");
  });

  it("increases login retry pauses and caps the maximum delay", () => {
    expect(loginAttemptDelay(1)).toBe(0);
    expect(loginAttemptDelay(3)).toBe(250);
    expect(loginAttemptDelay(4)).toBe(500);
    expect(loginAttemptDelay(20)).toBe(8_000);
  });

  it("keeps authenticated context request-scoped", async () => {
    await expect(withCurrentUser(user, async () => getCurrentUser().id)).resolves.toBe("user-1");
    expect(() => getCurrentUser()).toThrow("Authentication required.");
  });

  it("keeps administrative operations separate from clearance", () => {
    expect(() => withCurrentUser(user, () => requireAdmin())).toThrow("Access denied.");
    expect(
      withCurrentUser({ ...user, role: "admin", clearance: "open" }, () => requireAdmin()),
    ).toMatchObject({ role: "admin", clearance: "open" });
  });
});
