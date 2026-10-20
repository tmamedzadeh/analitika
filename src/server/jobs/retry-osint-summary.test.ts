import { describe, expect, it } from "vitest";

import { osintSummaryRetryClaimed } from "./retry-osint-summary";

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
});
