const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

type Bucket = { startedAt: number; count: number };

const buckets = new Map<string, Bucket>();

export function consumeAnalyticsRateLimit(key: string, now = Date.now()): boolean {
  const existing = buckets.get(key);
  if (!existing || now - existing.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (existing.count >= MAX_REQUESTS_PER_WINDOW) return false;
  existing.count += 1;
  return true;
}

export function getAnalyticsClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || forwarded || "unknown";
}
