import { and, eq, or, sql, type SQLWrapper } from "drizzle-orm";

import { getCurrentUser as getAuthenticatedUser, type SessionUser } from "@/server/auth";
import { appUsers, documents } from "./schema";

export type CurrentUser = SessionUser;

export function getCurrentUser(): CurrentUser {
  return getAuthenticatedUser();
}

// Records without a classification field (including all bulletins).
// Request authentication is still required by the Start middleware.
export function accessFilter(user: Pick<CurrentUser, "id"> = getCurrentUser()) {
  return sql`exists (
    select 1 from ${appUsers}
    where ${appUsers.id} = ${user.id} and ${appUsers.active} = true
  )`;
}

export function documentAccessFilter(user: Pick<CurrentUser, "id"> = getCurrentUser()) {
  return classificationAccessFilter(documents.classification, user);
}

export function briefAccessFilter(user: Pick<CurrentUser, "id"> = getCurrentUser()) {
  return accessFilter(user);
}

export function classificationAccessFilter(
  classification: SQLWrapper,
  user: Pick<CurrentUser, "id"> = getCurrentUser(),
) {
  // Read the live clearance in the same SQL statement that reads document data.
  // Session claims become stale when an administrator changes a user's clearance.
  // Unknown values and inactive/missing users fail closed. Ownership and role
  // do not raise the clearance ceiling.
  const documentLevel = sql<number>`case ${classification}
    when 'open' then 0
    when 'secret' then 1
    when 'top_secret' then 2
    when 'special' then 3
    else -1 end`;
  const userLevel = sql<number>`(
    select case ${appUsers.clearance}
      when 'open' then 0
      when 'secret' then 1
      when 'top_secret' then 2
      when 'special' then 3
      else -1 end
    from ${appUsers}
    where ${appUsers.id} = ${user.id} and ${appUsers.active} = true
  )`;
  return sql`${documentLevel} >= 0 and ${documentLevel} <= ${userLevel}`;
}

export function canManageDocument(user: CurrentUser, ownerId: string) {
  return user.role === "admin" || ownerId === user.id;
}

export function adminAccessFilter(user: Pick<CurrentUser, "id"> = getCurrentUser()) {
  return sql`exists (
    select 1 from ${appUsers}
    where ${appUsers.id} = ${user.id} and ${appUsers.active} = true and ${appUsers.role} = 'admin'
  )`;
}

export function documentManagementFilter(user: Pick<CurrentUser, "id"> = getCurrentUser()) {
  // Management never raises the clearance ceiling. Read the role from the DB,
  // too: a demoted administrator's in-flight request must not retain that power.
  return and(
    documentAccessFilter(user),
    or(eq(documents.ownerId, user.id), adminAccessFilter(user)),
  )!;
}

// Trusted document indexing workers use this predicate; never use it in request handlers.
export function systemAccessFilter() {
  return sql.raw("true");
}
