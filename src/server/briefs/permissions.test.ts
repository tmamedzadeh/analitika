import { describe, expect, it } from "vitest";

import { canDeleteBrief, canEditBrief } from "./mutations";

describe("daily brief permissions", () => {
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
