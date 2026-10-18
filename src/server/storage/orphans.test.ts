import { describe, expect, it } from "vitest";

import { findStaleUnreferencedStorageObjects } from "./orphans";

describe("orphaned upload cleanup", () => {
  it("selects abandoned uploads older than 24 hours and keeps referenced or recent objects", () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    const old = new Date("2026-10-17T11:59:59.000Z");
    const recent = new Date("2026-10-18T11:00:00.000Z");
    const candidates = [
      { key: "documents/dropped/photo.jpg", lastModified: old },
      { key: "briefs/saved/photo.png", lastModified: old },
      { key: "requests/recent/file.pdf", lastModified: recent },
    ];

    expect(
      findStaleUnreferencedStorageObjects(candidates, new Set(["briefs/saved/photo.png"]), now),
    ).toEqual(["documents/dropped/photo.jpg"]);
  });
});
