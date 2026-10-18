import { describe, expect, it } from "vitest";
import { conflictingBrief, demoBriefs, photoError } from "./briefs";
describe("Daily brief rules", () => {
  it("allows only one brief per date", () => { expect(conflictingBrief(demoBriefs, "2026-10-18")?.id).toBe("brief-18"); expect(conflictingBrief(demoBriefs, "2026-10-18", "brief-18")).toBeUndefined(); });
  it("allows up to 10 photos", () => { const file = { type: "image/jpeg", size: 100 }; expect(photoError(Array(10).fill(file))).toBeNull(); expect(photoError(Array(11).fill(file))).not.toBeNull(); });
  it("allows at most 10 MB per photo", () => { expect(photoError([{ type: "image/png", size: 10 * 1024 * 1024 }])).toBeNull(); expect(photoError([{ type: "image/png", size: 10 * 1024 * 1024 + 1 }])).not.toBeNull(); });
  it("accepts JPG PNG WebP only", () => { for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(photoError([{ type, size: 100 }])).toBeNull(); expect(photoError([{ type: "image/gif", size: 100 }])).not.toBeNull(); });
});