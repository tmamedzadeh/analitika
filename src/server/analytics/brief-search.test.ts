import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { analyticsFiltersSchema, type AnalyticsFilters } from "@/lib/analytics";
import { directionIds } from "@/lib/directions";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { searchSourceConditions } from "./search";

const defaults: AnalyticsFilters = {
  period: "all",
  tag: "",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

const testUser: SessionUser = {
  id: "test-user",
  username: "test",
  role: "user",
  clearance: "secret",
  sessionId: "test-session",
};

function compile(filters: AnalyticsFilters) {
  return withCurrentUser(testUser, () => {
    const condition = searchSourceConditions(filters);
    return new PgDialect().sqlToQuery(condition!);
  });
}

describe("daily brief retrieval filters", () => {
  it("requires a published, ready brief and applies accessFilter before RRF", () => {
    const query = compile(analyticsFiltersSchema.parse(defaults));
    expect(query.sql).toContain('"daily_briefs"."status" =');
    expect(query.sql).toContain('"daily_briefs"."index_status" =');
    expect(query.params).toContain("published");
    expect(query.params).toContain("ready");
    expect(query.sql).toContain("true");
  });

  it("applies the selected period to brief_date", () => {
    const filters = analyticsFiltersSchema.parse({ ...defaults, period: "30d" });
    const query = compile(filters);
    expect(query.sql).toContain('"daily_briefs"."brief_date" >=');
  });

  it("keeps briefs alongside documents when document-only filters are active", () => {
    const byTag = compile(analyticsFiltersSchema.parse({ ...defaults, tag: "demo-synthetic" }));
    expect(byTag.sql).toContain('"daily_briefs"."status" =');

    const byDirection = compile(
      analyticsFiltersSchema.parse({ ...defaults, directionIds: ["OSINT"] }),
    );
    expect(byDirection.sql).toContain('"daily_briefs"."status"');
    expect(byDirection.sql).toContain('"documents"."direction" in');

    const byReliability = compile(
      analyticsFiltersSchema.parse({ ...defaults, minInfoCredibility: "4" }),
    );
    expect(byReliability.sql).toContain('"daily_briefs"."status"');
    expect(byReliability.sql).toContain('"documents"."info_credibility" <=');
  });
});
