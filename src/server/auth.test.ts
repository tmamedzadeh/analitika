import { describe, expect, it } from "vitest";

import {
  allowedClassifications,
  canAccessClassification,
  getCurrentUser,
  loginRateLimitKeys,
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

  it("keeps clearance checks fail-closed for classified values", () => {
    expect(allowedClassifications({ clearance: "secret" })).toEqual(["open", "secret"]);
    expect(canAccessClassification(user, "open")).toBe(true);
    expect(canAccessClassification(user, "secret")).toBe(true);
    expect(canAccessClassification(user, "top_secret")).toBe(false);
    expect(canAccessClassification(user, "special")).toBe(false);
    expect(canAccessClassification({ clearance: "open" }, "secret")).toBe(false);
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
    const [accountKey, addressKey] = loginRateLimitKeys(first, "analyst");
    expect(accountKey).toBe(loginRateLimitKeys(sameAccount, "analyst")[0]);
    expect(addressKey).toBe(loginRateLimitKeys(sameAddress, "different-user")[1]);
    expect(accountKey).not.toContain("analyst");
    expect(addressKey).not.toContain("192.0.2.4");
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
