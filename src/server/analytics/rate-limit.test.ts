import { describe, expect, it } from "vitest";

import { getAnalyticsClientKey, rateLimitWindowStart } from "./rate-limit";

describe("IP rate-limit helpers", () => {
  it("places requests into fixed-size UTC windows", () => {
    expect(rateLimitWindowStart(60_001, 60_000).getTime()).toBe(60_000);
    expect(rateLimitWindowStart(119_999, 60_000).getTime()).toBe(60_000);
    expect(rateLimitWindowStart(120_000, 60_000).getTime()).toBe(120_000);
  });

  it("uses the forwarded client address and falls back to a stable unknown key", () => {
    expect(
      getAnalyticsClientKey(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" },
        }),
      ),
    ).toBe("203.0.113.8");
    expect(getAnalyticsClientKey(new Request("https://example.test"))).toBe("unknown");
  });
});
