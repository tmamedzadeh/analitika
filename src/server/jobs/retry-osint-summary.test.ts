import { describe, expect, it } from "vitest";

import { buildRetryProgress, osintSummaryRetryClaimed } from "./retry-osint-summary";

describe("OSINT summary retry idempotency", () => {
  it("only processes a run that was atomically claimed for summary retry", () => {
    expect(
      osintSummaryRetryClaimed({ status: "running", step: "summary_retrying", sourceCount: 3 }),
    ).toBe(true);
    expect(osintSummaryRetryClaimed({ status: "partial", step: "partial", sourceCount: 3 })).toBe(
      false,
    );
    expect(
      osintSummaryRetryClaimed({ status: "running", step: "summary_retrying", sourceCount: 0 }),
    ).toBe(false);
  });

  it("completes a fully repaired run while retaining the historical expansion failure", () => {
    const result = buildRetryProgress(
      {
        failedSteps: ["expansion:timeout"],
        partial: true,
        percent: 99,
      },
      {
        statusCounts: {},
        failureReasons: {},
        failures: [],
        notes: [],
        hasReport: true,
        elapsedMs: 2_000,
        summaryCalls: 0,
        reportAttempts: 1,
      },
    );

    expect(result.partial).toBe(false);
    expect(result.progress).toMatchObject({
      failedSteps: ["expansion:timeout"],
      partial: false,
      percent: 100,
    });
  });

  it("keeps the run partial for search failures or incomplete current output", () => {
    const input = {
      statusCounts: {},
      failureReasons: {},
      failures: [],
      notes: [],
      hasReport: true,
      elapsedMs: 2_000,
      summaryCalls: 0,
      reportAttempts: 1,
    };
    const searchFailure = buildRetryProgress(
      { failedSteps: ["expansion:timeout", "searching:az:timeout"] },
      input,
    );
    const incompleteOutput = buildRetryProgress(
      { failedSteps: ["expansion:timeout"] },
      { ...input, statusCounts: { generation_failed: 1 } },
    );

    expect(searchFailure.partial).toBe(true);
    expect(searchFailure.progress["failedSteps"]).toContain("searching:az:timeout");
    expect(incompleteOutput.partial).toBe(true);
  });
});
