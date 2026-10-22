import { describe, expect, it } from "vitest";

import { canDeleteBrief, canEditBrief, assertBriefClassificationWrite } from "./mutations";
import { clearanceValues } from "@/lib/classification";

describe("daily brief permissions", () => {
  it("checks all clearance levels for both roles and disallows non-admin declassification", () => {
    for (const role of ["user", "admin"] as const) {
      for (const [ceiling, clearance] of clearanceValues.entries()) {
        for (const [level, classification] of clearanceValues.entries()) {
          const write = () => assertBriefClassificationWrite({ role, clearance }, classification);
          if (level <= ceiling) expect(write).not.toThrow();
          else expect(write).toThrow();
        }
      }
    }
    expect(() =>
      assertBriefClassificationWrite({ role: "user", clearance: "special" }, "open", "secret"),
    ).toThrow();
    expect(() =>
      assertBriefClassificationWrite({ role: "admin", clearance: "special" }, "open", "secret"),
    ).not.toThrow();
    expect(() =>
      assertBriefClassificationWrite({ role: "admin", clearance: "open" }, "open", "secret"),
    ).toThrow();
  });
  const owner = { id: "user-1", role: "user" as const };
  const other = { id: "user-2", role: "user" as const };
  const admin = { id: "admin-1", role: "admin" as const };

  it("allows edits by the author and administrators only", () => {
    expect(canEditBrief(owner, owner.id)).toBe(true);
    expect(canEditBrief(other, owner.id)).toBe(false);
    expect(canEditBrief(admin, owner.id)).toBe(true);
  });

  it("allows deletion by administrators only", () => {
    expect(canDeleteBrief(owner)).toBe(false);
    expect(canDeleteBrief(admin)).toBe(true);
  });
});
