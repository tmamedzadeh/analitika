import { arrayContains, eq, gte, inArray, lte } from "drizzle-orm";

import type { AnalyticsFilters } from "@/lib/analytics";
import { departments } from "@/lib/departments";
import { accessFilter } from "@/server/db/access";
import { documents } from "@/server/db/schema";

export function minimumDocDate(period: AnalyticsFilters["period"]): string | null {
  if (period === "all") return null;
  const date = new Date();
  if (period === "30d") date.setUTCDate(date.getUTCDate() - 30);
  else date.setUTCMonth(date.getUTCMonth() - 12);
  return date.toISOString().slice(0, 10);
}

export function documentConditions(filters: AnalyticsFilters) {
  const conditions = [eq(documents.status, "ready"), accessFilter()];
  const fromDate = minimumDocDate(filters.period);
  if (fromDate) conditions.push(gte(documents.docDate, fromDate));
  if (filters.tag) conditions.push(arrayContains(documents.tags, [filters.tag]));
  if (filters.departmentIds.length < departments.length) {
    conditions.push(inArray(documents.department, filters.departmentIds));
  }

  if (filters.minSourceReliability !== "all") {
    const grades = ["A", "B", "C", "D", "E", "F"] as const;
    const index = grades.indexOf(filters.minSourceReliability);
    conditions.push(inArray(documents.sourceReliability, grades.slice(0, index + 1)));
  }
  if (filters.minInfoCredibility !== "all") {
    conditions.push(lte(documents.infoCredibility, Number(filters.minInfoCredibility)));
  }

  return conditions;
}
