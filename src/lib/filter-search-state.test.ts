import { describe, it, expect } from "vitest";
import { analyticsFiltersSchema, analyticsSearchRequestSchema } from "./analytics";
import { directionIds } from "./directions";
import { parseAnalyticsSearch, parsePeriodSearch, parseRatingsSearch } from "./filter-search-state";
const initial = analyticsFiltersSchema.parse({ directionIds: [...directionIds] });
describe("validated reloadable filter state", () => {
  it("restores confirmed custom dates and rejects malformed or future ranges", () => {
    expect(parsePeriodSearch({ period: "custom", from: "2026-10-01", to: "2026-10-18" })).toEqual({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-18",
    });
    expect(parsePeriodSearch({ period: "custom", from: "2026-02-30", to: "2026-10-18" })).toEqual({
      period: "30d",
    });
    expect(parsePeriodSearch({ period: "custom", from: "2099-01-01", to: "2099-01-02" })).toEqual({
      period: "30d",
    });
  });
  it("keeps old period/threshold semantics and missing includeBriefs OFF on reload", () => {
    const legacy = {
      period: "all",
      directionIds: [...directionIds],
      minSourceReliability: "C",
      minInfoCredibility: "4",
    };
    expect(parseAnalyticsSearch(legacy, initial)).toEqual({ ...legacy, includeBriefs: false });
    expect(
      parseAnalyticsSearch(
        { ...initial, includeBriefs: false, sourceReliabilities: ["A", "C"] },
        initial,
      ),
    ).toMatchObject({ includeBriefs: false, sourceReliabilities: ["A", "C"], filterVersion: 2 });
  });
  it("retains an empty-direction UI draft without permitting it at the API", () => {
    const draft = parseAnalyticsSearch({ ...initial, directionIds: [] }, initial);
    expect(draft.directionIds).toEqual([]);
    expect(
      analyticsSearchRequestSchema.safeParse({
        query: "Synthetic",
        filters: draft,
        mode: "sources",
      }).success,
    ).toBe(false);
  });
  it("restores exact grades and rejects retired rating values", () => {
    expect(
      parseRatingsSearch({ sourceReliabilities: ["A", "C"], infoCredibilities: [1, 3] }),
    ).toEqual({ sourceReliabilities: ["A", "C"], infoCredibilities: [1, 3] });
    expect(parseRatingsSearch({ sourceReliabilities: ["F"], infoCredibilities: [6] })).toEqual({
      sourceReliabilities: [],
      infoCredibilities: [],
    });
  });
});
