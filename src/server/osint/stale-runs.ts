import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { az } from "@/lib/i18n/az";
import { getDb } from "@/server/db";
import { osintRuns, osintSources } from "@/server/db/schema";

export const OSINT_STALE_AFTER_MS = 4 * 60_000;

export function isOsintHeartbeatStale(heartbeatAt: Date | null, now = new Date()): boolean {
  return heartbeatAt === null || now.getTime() - heartbeatAt.getTime() > OSINT_STALE_AFTER_MS;
}

export function staleOsintRunOutcome(input: {
  hasSources: boolean;
  summary: string | null;
  progress: unknown;
}) {
  const progress =
    input.progress && typeof input.progress === "object"
      ? (input.progress as Record<string, unknown>)
      : {};
  if (input.hasSources) {
    return {
      status: "partial" as const,
      step: "partial",
      summary: null,
      error: null,
      progress: {
        ...progress,
        percent: Math.min(typeof progress["percent"] === "number" ? progress["percent"] : 0, 99),
        partial: true,
        notice: az.osint.partialNotice,
      },
    };
  }
  return {
    status: "failed" as const,
    step: "failed",
    summary: input.summary,
    error: az.osint.jobFailed,
    progress: { ...progress, percent: 100 },
  };
}

export async function markStaleOsintRuns(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - OSINT_STALE_AFTER_MS);
  const db = getDb();
  const candidates = await db
    .select({
      id: osintRuns.id,
      summary: osintRuns.summary,
      progress: osintRuns.progress,
    })
    .from(osintRuns)
    .where(
      and(
        inArray(osintRuns.status, ["queued", "running"]),
        or(isNull(osintRuns.heartbeatAt), lt(osintRuns.heartbeatAt, cutoff)),
      ),
    )
    .limit(100);
  if (!candidates.length) return 0;

  const sourceCounts = await db
    .select({ runId: osintSources.runId, count: sql<number>`count(*)::int` })
    .from(osintSources)
    .where(
      inArray(
        osintSources.runId,
        candidates.map((run) => run.id),
      ),
    )
    .groupBy(osintSources.runId);
  const runsWithSources = new Set(sourceCounts.map((row) => row.runId));
  let closed = 0;
  for (const run of candidates) {
    const outcome = staleOsintRunOutcome({
      hasSources: runsWithSources.has(run.id),
      summary: run.summary,
      progress: run.progress,
    });
    const updated = await db
      .update(osintRuns)
      .set({ ...outcome, heartbeatAt: now, finishedAt: now })
      .where(
        and(
          eq(osintRuns.id, run.id),
          inArray(osintRuns.status, ["queued", "running"]),
          or(isNull(osintRuns.heartbeatAt), lt(osintRuns.heartbeatAt, cutoff)),
        ),
      )
      .returning({ id: osintRuns.id });
    closed += updated.length;
  }
  return closed;
}
