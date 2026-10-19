import { and, arrayContains, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import type { AnalyticsFilters } from "@/lib/analytics";
import { directions } from "@/lib/directions";
import { documentAccessFilter } from "@/server/db/access";
import { documents } from "@/server/db/schema";

export function minimumDocDate(
  period: AnalyticsFilters["period"],
  now = new Date(),
): string | null {
  if (period === "all") return null;
  const date = new Date(now);
  if (period === "7d") date.setUTCDate(date.getUTCDate() - 7);
  else if (period === "30d") date.setUTCDate(date.getUTCDate() - 30);
  else if (period === "90d") date.setUTCDate(date.getUTCDate() - 90);
  else date.setUTCMonth(date.getUTCMonth() - 12);
  return date.toISOString().slice(0, 10);
}

export function documentConditions(filters: AnalyticsFilters, now = new Date()) {
  const conditions = [eq(documents.status, "ready"), documentAccessFilter()];
  const fromDate = minimumDocDate(filters.period, now);
  if (fromDate) {
    const periodCondition = or(
      gte(documents.docDate, fromDate),
      and(
        isNull(documents.docDate),
        gte(documents.createdAt, new Date(`${fromDate}T00:00:00.000Z`)),
      ),
    );
    if (periodCondition) conditions.push(periodCondition);
  }
  if (filters.tag) conditions.push(arrayContains(documents.tags, [filters.tag]));
  if (filters.directionIds.length < directions.length) {
    conditions.push(inArray(documents.direction, filters.directionIds));
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
