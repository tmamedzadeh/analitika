import { describe, expect, it, vi } from "vitest";

import { deleteObjectsBestEffort } from "./delete-objects";

describe("best-effort storage cleanup", () => {
  it("attempts every object and reports an incomplete cleanup", async () => {
    const remove = vi.fn((key: string) => {
      if (key === "documents/failing") throw new Error("storage unavailable");
      return Promise.resolve();
    });

    await expect(
      deleteObjectsBestEffort(["documents/failing", "documents/other"], remove),
    ).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("reports complete cleanup when every deletion succeeds", async () => {
    await expect(deleteObjectsBestEffort(["requests/one"], async () => {})).resolves.toBe(false);
  });
});
