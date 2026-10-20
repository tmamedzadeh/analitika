import { describe, expect, it } from "vitest";

import {
  hasOriginMetadata,
  isSignedInngestPath,
  isUnsafeMethod,
  shouldRejectMissingOrigin,
} from "../../lib/security/csrf";

describe("same-origin request policy", () => {
  it("checks every unsafe method and ignores safe methods", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(isUnsafeMethod(method)).toBe(true);
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(isUnsafeMethod(method)).toBe(false);
  });

  it("requires a valid session for unsafe non-browser requests with no origin headers", () => {
    const request = new Request("https://app.example/api/action", { method: "POST" });
    expect(hasOriginMetadata(request)).toBe(false);
    expect(shouldRejectMissingOrigin(request, false)).toBe(true);
    expect(shouldRejectMissingOrigin(request, true)).toBe(false);
  });

  it("keeps signed Inngest routes outside the browser-origin check", () => {
    const request = new Request("https://app.example/api/inngest", { method: "POST" });
    expect(isSignedInngestPath(new URL(request.url).pathname)).toBe(true);
    expect(shouldRejectMissingOrigin(request, false)).toBe(false);
  });
});
