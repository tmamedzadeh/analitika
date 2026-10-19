import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { directions, directionIds } from "@/lib/directions";
import { analyticsFiltersSchema } from "@/lib/analytics";
import { documentConditions, minimumDocDate } from "./filters";

const baseFilters = {
  period: "all" as const,
  tag: "",
  directionIds: [...directionIds],
  minSourceReliability: "all" as const,
  minInfoCredibility: "all" as const,
};

describe("analytics direction filters", () => {
  it("applies selected direction IDs in SQL with accessFilter before RRF", () => {
    const filters = analyticsFiltersSchema.parse({
      ...baseFilters,
      directionIds: ["OSINT", "GEOINT"],
    });
    const where = and(...documentConditions(filters));
    const query = new PgDialect().sqlToQuery(where!);

    expect(query.sql).toContain('"documents"."direction" in');
    expect(query.sql).toContain("true");
    expect(query.params).toContain("OSINT");
    expect(query.params).toContain("GEOINT");
  });

  it("omits the direction condition when every direction is selected", () => {
    const filters = analyticsFiltersSchema.parse(baseFilters);
    const query = new PgDialect().sqlToQuery(and(...documentConditions(filters))!);

    expect(query.sql).not.toContain('"documents"."direction" in');
    expect(query.sql).toContain("true");
    expect(filters.directionIds).toHaveLength(directions.length);
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

  it("calculates week, quarter, and year period boundaries", () => {
    const now = new Date("2026-10-18T18:00:00.000Z");

    expect(minimumDocDate("7d", now)).toBe("2026-10-11");
    expect(minimumDocDate("30d", now)).toBe("2026-09-18");
    expect(minimumDocDate("90d", now)).toBe("2026-07-20");
    expect(minimumDocDate("12m", now)).toBe("2025-10-18");
  });
});
