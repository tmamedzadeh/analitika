import { eq, or } from "drizzle-orm";

import type { SessionUser } from "../auth";
import { osintRuns } from "../db/schema";

export function canAccessOsintRun(
  user: Pick<SessionUser, "id" | "role">,
  run: Pick<typeof osintRuns.$inferSelect, "createdBy" | "pinned">,
): boolean {
  return user.role === "admin" || run.createdBy === user.id || run.pinned;
}

export function osintRunHistoryFilter(user: Pick<SessionUser, "id" | "role">) {
  return user.role === "admin"
    ? undefined
    : or(eq(osintRuns.createdBy, user.id), eq(osintRuns.pinned, true));
}
