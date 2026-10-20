import { describe, expect, it } from "vitest";

import { canAccessOsintRun, osintRunHistoryFilter } from "./access";

describe("OSINT run ownership", () => {
  it("limits ordinary users to their own runs while keeping pinned demos public", () => {
    const user = { id: "user-a", role: "user" as const };
    expect(canAccessOsintRun(user, { createdBy: "user-a", pinned: false })).toBe(true);
    expect(canAccessOsintRun(user, { createdBy: "user-b", pinned: false })).toBe(false);
    expect(canAccessOsintRun(user, { createdBy: "user-b", pinned: true })).toBe(true);
  });

  it("allows an administrator to inspect every run", () => {
    expect(
      canAccessOsintRun({ id: "admin", role: "admin" }, { createdBy: "user-b", pinned: false }),
    ).toBe(true);
  });

  it("builds an owner-or-pinned SQL filter and no filter for administrators", () => {
    expect(osintRunHistoryFilter({ id: "user-a", role: "user" })).toBeDefined();
    expect(osintRunHistoryFilter({ id: "admin", role: "admin" })).toBeUndefined();
  });
});
