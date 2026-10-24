import { describe, it, expect } from "vitest";
import { resolvePeriod } from "./period";
import {
  analyticsFiltersSchema,
  legacyAnalyticsFiltersSchema,
  parseHistoryFilters,
} from "./analytics";
import { directionIds } from "./directions";

describe("shared inclusive Baku periods", () => {
  it("represents the full archive without artificial date bounds", () => {
    expect(resolvePeriod({ period: "all", from: "2000-01-01", to: "2000-01-02" })).toBeNull();
    expect(
      analyticsFiltersSchema.parse({ directionIds: [...directionIds], period: "all" }).period,
    ).toBe("all");
  });
  it("respects historical Asia/Baku summer offset for custom ranges", () => {
    const window = resolvePeriod({ period: "custom", from: "2015-07-01", to: "2015-07-01" });
    expect(window.start.toISOString()).toBe("2015-06-30T19:00:00.000Z");
    expect(window.endExclusive.toISOString()).toBe("2015-07-01T19:00:00.000Z");
  });
  it("keeps an entire historical daylight-saving transition date", () => {
    const window = resolvePeriod({ period: "custom", from: "2015-03-29", to: "2015-03-29" });
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
  const now = new Date("2026-10-21T20:01:00Z"); // October 22 in Baku
  it.each([
    ["30d", "2026-09-23"],
    ["90d", "2026-07-25"],
    ["12m", "2025-10-23"],
  ] as const)("resolves rolling %s including today", (period, from) => {
    expect(resolvePeriod({ period }, now)).toEqual({
      from,
      through: "2026-10-22",
      start: new Date(`${from}T00:00:00+04:00`),
      endExclusive: new Date("2026-10-22T20:00:00Z"),
    });
  });
  it("uses clamped anniversaries for leap years", () => {
    expect(resolvePeriod({ period: "12m" }, new Date("2024-02-29T08:00:00Z")).from).toBe(
      "2023-03-01",
    );
    expect(resolvePeriod({ period: "12m" }, new Date("2025-02-28T08:00:00Z")).from).toBe(
      "2024-02-29",
    );
  });
  it("accepts one inclusive day and ignores custom dates after switching presets", () => {
    const window = resolvePeriod({ period: "custom", from: "2026-10-21", to: "2026-10-21" }, now);
    expect(window.start.toISOString()).toBe("2026-10-20T20:00:00.000Z");
    expect(window.endExclusive.toISOString()).toBe("2026-10-21T20:00:00.000Z");
    expect(resolvePeriod({ period: "30d", from: "2000-01-01", to: "2000-01-02" }, now)).toEqual(
      resolvePeriod({ period: "30d" }, now),
    );
  });
  it.each([
    { from: "2026-10-22", to: "2026-10-21" },
    { from: "2026-10-21", to: "2026-10-23" },
    { from: "2026-02-30", to: "2026-10-22" },
    { from: "2026-10-22" },
  ])("rejects invalid custom boundaries %j", (range) => {
    expect(() => resolvePeriod({ period: "custom", ...range }, now)).toThrow();
  });
});

describe("new requests and immutable legacy filter compatibility", () => {
  it("defaults new requests to Son ay and bulletins ON with exact rating sets", () => {
    const filters = analyticsFiltersSchema.parse({ directionIds: [...directionIds] });
    expect(filters).toMatchObject({
      filterVersion: 2,
      period: "30d",
      includeBriefs: true,
      sourceReliabilities: [],
      infoCredibilities: [],
    });
  });
  it.each(["7d", "all"])(
    "reads legacy %s with OFF and thresholds, but rejects a new submission",
    (period) => {
      const snapshot = {
        period,
        directionIds: [...directionIds],
        minSourceReliability: "F",
        minInfoCredibility: "6",
      };
      const before = JSON.stringify(snapshot);
      const read = parseHistoryFilters(snapshot);
      expect(read.success && read.data).toMatchObject({ ...snapshot, includeBriefs: false });
      expect(analyticsFiltersSchema.safeParse(snapshot).success).toBe(false);
      expect(JSON.stringify(snapshot)).toBe(before);
    },
  );
  it("does not silently reinterpret a supported legacy period with thresholds", () => {
    const legacy = legacyAnalyticsFiltersSchema.parse({
      period: "30d",
      directionIds: [...directionIds],
      minSourceReliability: "C",
      minInfoCredibility: "4",
    });
    expect(parseHistoryFilters(legacy).success).toBe(true);
    expect(analyticsFiltersSchema.safeParse(legacy).success).toBe(false);
    expect(
      analyticsFiltersSchema.safeParse({
        ...legacy,
        minSourceReliability: "all",
        minInfoCredibility: "all",
        sourceReliabilities: ["F"],
      }).success,
    ).toBe(false);
  });
});
