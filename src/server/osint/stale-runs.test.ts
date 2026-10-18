import { describe, expect, it } from "vitest";

import { isOsintHeartbeatStale, OSINT_STALE_AFTER_MS, staleOsintRunOutcome } from "./stale-runs";

describe("stale OSINT run recovery", () => {
  it("closes a heartbeat after four minutes and ignores a fresh one", () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    expect(isOsintHeartbeatStale(new Date(now.getTime() - OSINT_STALE_AFTER_MS - 1), now)).toBe(
      true,
    );
    expect(isOsintHeartbeatStale(new Date(now.getTime() - OSINT_STALE_AFTER_MS), now)).toBe(false);
    expect(isOsintHeartbeatStale(new Date(now.getTime() - 1_000), now)).toBe(false);
  });

  it("keeps source-bearing stalled runs as partial results", () => {
    const result = staleOsintRunOutcome({
      hasSources: true,
      summary: "Existing summary",
      progress: { completedLanguages: 1, percent: 64 },
    });
    expect(result.status).toBe("done");
    expect(result.step).toBe("partial");
    expect(result.summary).toBe("Existing summary");
    expect(result.progress).toMatchObject({ percent: 100, partial: true, completedLanguages: 1 });
    expect("notice" in result.progress && result.progress.notice).toBeTruthy();
  });

  it("fails stalled runs that never persisted a source", () => {
    const result = staleOsintRunOutcome({ hasSources: false, summary: null, progress: {} });
    expect(result.status).toBe("failed");
    expect(result.step).toBe("failed");
    expect(result.summary).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
