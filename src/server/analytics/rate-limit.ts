import { sql } from "drizzle-orm";

import { getDb } from "@/server/db";
import { rateLimits } from "@/server/db/schema";

const ANALYTICS_WINDOW_MS = 60_000;

export function rateLimitWindowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export async function consumeIpRateLimit(
  scope: string,
  request: Request,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const key = `${scope}:${getAnalyticsClientKey(request)}`;
  const windowStart = rateLimitWindowStart(now, windowMs);
  const [bucket] = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < ${windowStart} THEN ${windowStart} ELSE ${rateLimits.windowStart} END`,
        count: sql`CASE WHEN ${rateLimits.windowStart} < ${windowStart} THEN 1 ELSE ${rateLimits.count} + 1 END`,
      },
    })
    .returning({ count: rateLimits.count });
  if (!bucket) return false;
  return bucket.count <= limit;
}

export function consumeAnalyticsRateLimit(request: Request): Promise<boolean> {
  return consumeIpRateLimit("analytics-search", request, 20, ANALYTICS_WINDOW_MS);
}

export function getAnalyticsClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || forwarded || "unknown";
}
