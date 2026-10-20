import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { directions, directionIds } from "@/lib/directions";
import { analyticsFiltersSchema, type AnalyticsFilters } from "@/lib/analytics";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { documentConditions, minimumDocDate } from "./filters";

const baseFilters = {
  period: "all" as const,
  tag: "",
  directionIds: [...directionIds],
  minSourceReliability: "all" as const,
  minInfoCredibility: "all" as const,
};

const testUser: SessionUser = {
  id: "test-user",
  username: "test",
  role: "user",
  clearance: "secret",
  sessionId: "test-session",
};

function documentWhere(filters: AnalyticsFilters, now?: Date) {
  return withCurrentUser(testUser, () => and(...documentConditions(filters, now))!);
}

describe("analytics direction filters", () => {
  it("applies selected direction IDs in SQL with accessFilter before RRF", () => {
    const filters = analyticsFiltersSchema.parse({
      ...baseFilters,
      directionIds: ["OSINT", "GEOINT"],
    });
    const where = documentWhere(filters);
    const query = new PgDialect().sqlToQuery(where!);

    expect(query.sql).toContain('"documents"."direction" in');
    expect(query.sql).toContain('"documents"."classification" in');
    expect(query.sql).toContain("exists (select 1 from document_acl");
    expect(query.sql).toContain('"documents"."owner_id" =');
    expect(query.params).toContain("open");
    expect(query.params).toContain("secret");
    expect(query.params).toContain("OSINT");
    expect(query.params).toContain("GEOINT");
  });

  it("omits the direction condition when every direction is selected", () => {
    const filters = analyticsFiltersSchema.parse(baseFilters);
    const query = new PgDialect().sqlToQuery(documentWhere(filters));

    expect(query.sql).not.toContain('"documents"."direction" in');
    expect(query.sql).toContain('"documents"."classification" in');
    expect(filters.directionIds).toHaveLength(directions.length);
  });

  it("applies a stable period window and falls back to creation date when doc date is missing", () => {
    const filters = analyticsFiltersSchema.parse({ ...baseFilters, period: "30d" });
    const now = new Date("2026-10-18T18:00:00.000Z");
    const query = new PgDialect().sqlToQuery(documentWhere(filters, now));

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
