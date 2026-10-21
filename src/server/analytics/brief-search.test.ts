import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { analyticsFiltersSchema, type AnalyticsFilters } from "@/lib/analytics";
import { directionIds } from "@/lib/directions";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { searchSourceConditions } from "./search";

const defaults: AnalyticsFilters = {
  period: "all",
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

function compile(filters: AnalyticsFilters, now = new Date("2026-10-21T12:00:00.000Z")) {
  return withCurrentUser(testUser, () => {
    const condition = searchSourceConditions(filters, now);
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

  it("excludes briefs when a document-only filter is active", () => {
    const variants = [
      { ...defaults, directionIds: ["OSINT"] },
      { ...defaults, minSourceReliability: "C" },
      { ...defaults, minInfoCredibility: "4" },
    ];
    for (const value of variants) {
      const query = compile(analyticsFiltersSchema.parse(value));
      expect(query.sql).toContain('"documents"."chunk_count" >');
      expect(query.sql).toContain('"daily_briefs"."status" =');
      expect(query.sql).toContain("false");
    }
  });

  it("uses inclusive period boundaries and excludes future-dated documents and briefs", () => {
    const filters = analyticsFiltersSchema.parse({ ...defaults, period: "7d" });
    const query = compile(filters);
    expect(query.sql).toContain('"daily_briefs"."brief_date" >=');
    expect(query.sql).toContain('"daily_briefs"."brief_date" <=');
    expect(query.sql).toContain('"documents"."doc_date" <=');
    expect(query.params).toContain("2026-10-14");
    expect(query.params).toContain("2026-10-21");
    expect(query.sql).toContain('"documents"."created_at" <=');
  });
});
