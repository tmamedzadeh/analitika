import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { analyticsFiltersSchema, type AnalyticsFilters } from "@/lib/analytics";
import { departmentIds } from "@/lib/departments";
import { searchSourceConditions } from "./search";

const defaults: AnalyticsFilters = {
  period: "all",
  tag: "",
  departmentIds: [...departmentIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

function compile(filters: AnalyticsFilters) {
  const condition = searchSourceConditions(filters);
  return new PgDialect().sqlToQuery(condition!);
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

  it("keeps briefs when tags are active, but excludes them for department and reliability filters", () => {
    const byTag = compile(analyticsFiltersSchema.parse({ ...defaults, tag: "demo-synthetic" }));
    expect(byTag.sql).toContain('"daily_briefs"."status" =');

    const byDepartment = compile(
      analyticsFiltersSchema.parse({ ...defaults, departmentIds: ["d1"] }),
    );
    expect(byDepartment.sql).not.toContain('"daily_briefs"."status"');

    const byReliability = compile(
      analyticsFiltersSchema.parse({ ...defaults, minInfoCredibility: "4" }),
    );
    expect(byReliability.sql).not.toContain('"daily_briefs"."status"');
  });
});
