import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function indexProgress(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function recoveryAttempts(value: unknown): number {
  const attempts = indexProgress(value)["recoveryAttempts"];
  return typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts >= 0
    ? attempts
    : 0;
}

/** A fresh claim fences out every heartbeat, finalization, and failure of its predecessor. */
export function indexLeaseCondition(progress: AnyPgColumn, leaseId: string): SQL {
  return sql`${progress} ->> 'leaseId' = ${leaseId}`;
}

export function mergeIndexProgress(progress: AnyPgColumn, value: Record<string, unknown>): SQL {
  return sql`${progress} || ${JSON.stringify(value)}::jsonb`;
}

export const INDEX_BATCH_TIMEOUT_MS = 90_000;
