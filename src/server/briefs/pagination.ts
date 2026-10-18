import { and, eq, gt, lt, or } from "drizzle-orm";

import type { BriefCursor } from "@/lib/briefs";
import { dailyBriefs } from "@/server/db/schema";

export function afterBriefPosition(position: BriefCursor) {
  return or(
    lt(dailyBriefs.briefDate, position.date),
    and(eq(dailyBriefs.briefDate, position.date), lt(dailyBriefs.id, position.id)),
  )!;
}

export function beforeBriefPosition(position: BriefCursor) {
  return or(
    gt(dailyBriefs.briefDate, position.date),
    and(eq(dailyBriefs.briefDate, position.date), gt(dailyBriefs.id, position.id)),
  )!;
}

export function compareBriefPositions(first: BriefCursor, second: BriefCursor): number {
  if (first.date !== second.date) return first.date > second.date ? -1 : 1;
  if (first.id === second.id) return 0;
  return first.id > second.id ? -1 : 1;
}

export function isAfterBriefPosition(candidate: BriefCursor, position: BriefCursor): boolean {
  return compareBriefPositions(candidate, position) > 0;
}

export function paginateBriefPositions<T extends BriefCursor>(
  positions: readonly T[],
  cursor: BriefCursor | null,
  pageSize: number,
): { items: T[]; nextCursor: BriefCursor | null } {
  const ordered = [...positions].sort(compareBriefPositions);
  const remaining = cursor ? ordered.filter((item) => isAfterBriefPosition(item, cursor)) : ordered;
  const page = remaining.slice(0, pageSize);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: remaining.length > pageSize && last ? { date: last.date, id: last.id } : null,
  };
}

export function briefNeighbors<T extends BriefCursor & { id: string }>(
  positions: readonly T[],
  currentId: string,
): { previousId: string | null; nextId: string | null } {
  const ordered = [...positions].sort(compareBriefPositions);
  const index = ordered.findIndex((item) => item.id === currentId);
  if (index < 0) return { previousId: null, nextId: null };
  return {
    previousId: ordered[index + 1]?.id ?? null,
    nextId: ordered[index - 1]?.id ?? null,
  };
}
