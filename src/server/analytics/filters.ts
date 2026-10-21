import { and, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { AnalyticsFilters } from "@/lib/analytics";
import { directions } from "@/lib/directions";
import { documentAccessFilter } from "@/server/db/access";
import { documents } from "@/server/db/schema";
import { getBakuDate } from "@/lib/briefs";

export function minimumDocDate(
  period: AnalyticsFilters["period"],
  now = new Date(),
): string | null {
  if (period === "all") return null;
  const date = new Date(`${getBakuDate(now)}T00:00:00.000Z`);
  if (period === "7d") date.setUTCDate(date.getUTCDate() - 7);
  else if (period === "30d") date.setUTCDate(date.getUTCDate() - 30);
  else if (period === "90d") date.setUTCDate(date.getUTCDate() - 90);
  else date.setUTCMonth(date.getUTCMonth() - 12);
  return date.toISOString().slice(0, 10);
}

/**
 * Chunk count records the last committed index. It stays unchanged while a new index is staged,
 * so the last good chunks remain searchable when status is queued, processing, or failed.
 */
export function hasCommittedDocumentIndex() {
  return gt(documents.chunkCount, 0);
}

export function documentConditions(filters: AnalyticsFilters, now = new Date()) {
  const conditions = [hasCommittedDocumentIndex(), documentAccessFilter()];
  const today = getBakuDate(now);
  conditions.push(
    or(
      lte(documents.docDate, today),
      and(isNull(documents.docDate), lte(documents.createdAt, now)),
    )!,
  );
  const fromDate = minimumDocDate(filters.period, now);
  if (fromDate) {
    const periodCondition = or(
      gte(documents.docDate, fromDate),
      and(
        isNull(documents.docDate),
        gte(documents.createdAt, new Date(`${fromDate}T00:00:00.000+04:00`)),
      ),
    );
    if (periodCondition) conditions.push(periodCondition);
  }
  const selectedDirections = new Set(filters.directionIds);
  const validDirectionIds = new Set(directions.map(({ id }) => id));
  if (
    selectedDirections.size === 0 ||
    [...selectedDirections].some((id) => !validDirectionIds.has(id))
  ) {
    conditions.push(sql`false`);
  } else if (selectedDirections.size < directions.length) {
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
