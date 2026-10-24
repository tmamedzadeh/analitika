import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { withCurrentUser, type SessionUser } from "@/server/auth";
import {
  accessFilter,
  briefAccessFilter,
  canManageDocument,
  documentAccessFilter,
  documentManagementFilter,
} from "./access";

const user: SessionUser = {
  id: "clearance-user",
  username: "analyst",
  role: "user",
  clearance: "secret",
  sessionId: "session",
};

describe("document visibility predicate", () => {
  it("requires an active user for open briefs across roles", () => {
    for (const role of ["user", "admin"] as const) {
      const query = new PgDialect().sqlToQuery(
        withCurrentUser({ ...user, role }, () => briefAccessFilter()),
      );
      expect(query.sql).not.toContain("classification");
      expect(query.sql).toContain('"app_users"."active" = true');
      expect(query.sql).not.toContain('"author_id"');
      expect(query.params).toEqual([user.id]);
    }
  });
  it("reads active clearance from the database in the content predicate", () => {
    const query = new PgDialect().sqlToQuery(withCurrentUser(user, () => documentAccessFilter()));
    expect(query.sql).toContain('case "documents"."classification"');
    expect(query.sql).toContain('from "app_users"');
    expect(query.sql).toContain('"app_users"."active" = true');
    expect(query.sql).toContain('"app_users"."clearance"');
    expect(query.sql).not.toContain('"documents"."owner_id"');
    expect(query.params).toEqual(["clearance-user"]);
  });

  it("does not let an owner or administrator role replace the live database clearance", () => {
    for (const candidate of [user, { ...user, role: "admin" as const }]) {
      const query = new PgDialect().sqlToQuery(
        withCurrentUser(candidate, () => documentAccessFilter()),
      );
      expect(query.sql).toContain('from "app_users"');
      expect(query.params).toEqual(["clearance-user"]);
    }
  });

  it("requires an active database user for records without classification", () => {
    const query = new PgDialect().sqlToQuery(withCurrentUser(user, () => accessFilter()));
    expect(query.sql).toContain('"app_users"."active" = true');
    expect(query.params).toEqual(["clearance-user"]);
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

  it("keeps live clearance, active state and admin role in every management query", () => {
    for (const candidate of [user, { ...user, role: "admin" as const }]) {
      const query = new PgDialect().sqlToQuery(documentManagementFilter(candidate)!);
      expect(query.sql).toContain('case "documents"."classification"');
      expect(query.sql).toContain('"app_users"."active" = true');
      expect(query.sql).toContain('"app_users"."role" = \'admin\'');
      expect(query.sql).toContain('"documents"."owner_id" =');
    }
  });
});
