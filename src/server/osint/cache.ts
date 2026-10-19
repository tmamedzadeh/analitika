import { and, desc, eq } from "drizzle-orm";

import { getDb } from "../db";
import { osintRuns } from "../db/schema";

export function shouldServePinnedCache(input: {
  pinned: boolean;
  done: boolean;
  refresh: boolean;
}): boolean {
  return input.pinned && input.done && !input.refresh;
}

export function shouldReadOsintSearchCache(refresh: boolean): boolean {
  return !refresh;
}

export async function findPinnedOsintRun(cacheKey: string) {
  const [run] = await getDb()
    .select({ id: osintRuns.id, status: osintRuns.status, pinned: osintRuns.pinned })
    .from(osintRuns)
    .where(
      and(
        eq(osintRuns.cacheKey, cacheKey),
        eq(osintRuns.pinned, true),
        eq(osintRuns.status, "done"),
      ),
    )
    .orderBy(desc(osintRuns.createdAt))
    .limit(1);
  return run ?? null;
}
