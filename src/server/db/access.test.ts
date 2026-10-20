import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { withCurrentUser, type SessionUser } from "@/server/auth";
import { canManageDocument, documentAccessFilter, documentManagementFilter } from "./access";

const user: SessionUser = {
  id: "clearance-user",
  username: "analyst",
  role: "user",
  clearance: "secret",
  sessionId: "session",
};

describe("document visibility predicate", () => {
  it("combines hierarchy, owner, and indexed ACL EXISTS checks", () => {
    const query = new PgDialect().sqlToQuery(withCurrentUser(user, () => documentAccessFilter()));
    expect(query.sql).toContain('"documents"."classification" in');
    expect(query.sql).toContain("exists (select 1 from document_acl");
    expect(query.sql).toContain('"documents"."owner_id" =');
    expect(query.sql).toContain('document_acl.document_id = "documents"."id"');
    expect(query.params).toEqual(expect.arrayContaining(["open", "secret", user.id]));
  });
});

describe("document management permission", () => {
  it("allows only the owner or an administrator to manage a document", () => {
    expect(canManageDocument(user, user.id)).toBe(true);
    expect(canManageDocument(user, "another-user")).toBe(false);
    expect(canManageDocument({ ...user, role: "admin" }, "another-user")).toBe(true);
  });

  it("limits non-admin management queries to documents owned by the user", () => {
    const query = new PgDialect().sqlToQuery(
      withCurrentUser(user, () => documentManagementFilter()),
    );
    expect(query.sql).toContain('"documents"."owner_id" =');
    expect(query.params).toContain(user.id);
  });
});
