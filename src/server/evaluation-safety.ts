import { withCurrentUser, type SessionUser } from "./auth";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { appUsers } from "./db/schema";

let evaluationUser: SessionUser | undefined;

/** Evaluation uses only the configured project database and never overrides its URL. */
export function requireProjectEvaluationDatabase(): void {
  if (!process.env["DATABASE_URL"]?.trim()) {
    throw new Error("Evaluation blocked: configured project database is unavailable.");
  }
  if (process.env["ANALYTICS_EVAL_DATABASE_URL"]?.trim()) {
    throw new Error("Evaluation blocked: separate evaluation databases are not supported.");
  }
}

/** Synthetic fixture evaluation is disabled for this single-database project. */
export function requireSyntheticEvaluationDatabase(): never {
  throw new Error("Evaluation blocked: synthetic fixture databases are not supported.");
}

export async function withProjectEvaluationUser<T>(callback: () => T): Promise<Awaited<T>> {
  if (!evaluationUser) {
    const configuredId = process.env["EVALUATION_USER_ID"]?.trim();
    const [user] = await getDb()
      .select({
        id: appUsers.id,
        username: appUsers.username,
        role: appUsers.role,
        clearance: appUsers.clearance,
      })
      .from(appUsers)
      .where(
        and(eq(appUsers.active, true), configuredId ? eq(appUsers.id, configuredId) : undefined),
      )
      .orderBy(asc(appUsers.id))
      .limit(1);
    if (!user) throw new Error("Evaluation requires an active project user.");
    evaluationUser = {
      ...user,
      clearance: user.clearance as SessionUser["clearance"],
      sessionId: "read-only-evaluation",
    };
  }
  return await withCurrentUser(evaluationUser, callback);
}
