import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { departments, departmentIds } from "@/lib/departments";
import { analyticsFiltersSchema } from "@/lib/analytics";
import { documentConditions, minimumDocDate } from "./filters";

const baseFilters = {
  period: "all" as const,
  tag: "",
  departmentIds: [...departmentIds],
  minSourceReliability: "all" as const,
  minInfoCredibility: "all" as const,
};

describe("analytics department filters", () => {
  it("applies selected department IDs in SQL with accessFilter before RRF", () => {
    const filters = analyticsFiltersSchema.parse({
      ...baseFilters,
      departmentIds: ["d2", "d4"],
    });
    const where = and(...documentConditions(filters));
    const query = new PgDialect().sqlToQuery(where!);

    expect(query.sql).toContain('"documents"."department" in');
    expect(query.sql).toContain("true");
    expect(query.params).toContain("d2");
    expect(query.params).toContain("d4");
  });

  it("omits the department condition when every department is selected", () => {
    const filters = analyticsFiltersSchema.parse(baseFilters);
    const query = new PgDialect().sqlToQuery(and(...documentConditions(filters))!);

    expect(query.sql).not.toContain('"documents"."department" in');
    expect(query.sql).toContain("true");
    expect(filters.departmentIds).toHaveLength(departments.length);
  });

  it("applies a stable period window and falls back to creation date when doc date is missing", () => {
    const filters = analyticsFiltersSchema.parse({ ...baseFilters, period: "30d" });
    const now = new Date("2026-10-18T18:00:00.000Z");
    const query = new PgDialect().sqlToQuery(and(...documentConditions(filters, now))!);

    expect(minimumDocDate("30d", now)).toBe("2026-09-18");
    expect(query.sql).toContain('"documents"."doc_date" >=');
    expect(query.sql).toContain('"documents"."doc_date" is null');
    expect(query.sql).toContain('"documents"."created_at" >=');
    expect(query.params).toContain("2026-09-18");
    expect(query.params).toContain("2026-09-18T00:00:00.000Z");
  });
});
