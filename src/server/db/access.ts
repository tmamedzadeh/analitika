import { eq, inArray, or, sql } from "drizzle-orm";

import {
  allowedClassifications,
  getCurrentUser as getAuthenticatedUser,
  type SessionUser,
} from "@/server/auth";
import { documents } from "./schema";

export type CurrentUser = SessionUser;

export function getCurrentUser(): CurrentUser {
  return getAuthenticatedUser();
}

// This predicate is for records that have no classification field (for example briefs).
// Request authentication is still required by the Start middleware.
export function accessFilter(_user: CurrentUser = getCurrentUser()) {
  return sql.raw("true");
}

export function documentAccessFilter(user: CurrentUser = getCurrentUser()) {
  return or(
    inArray(documents.classification, allowedClassifications(user)),
    sql`exists (select 1 from document_acl where document_acl.document_id = ${documents.id} and document_acl.user_id = ${user.id})`,
    sql`${documents.ownerId} = ${user.id}`,
  )!;
}

export function canManageDocument(user: CurrentUser, ownerId: string) {
  return user.role === "admin" || ownerId === user.id;
}

export function documentManagementFilter(user: CurrentUser = getCurrentUser()) {
  return user.role === "admin" ? sql.raw("true") : eq(documents.ownerId, user.id);
}

// Trusted document indexing workers use this predicate; never use it in request handlers.
export function systemAccessFilter() {
  return sql.raw("true");
}
