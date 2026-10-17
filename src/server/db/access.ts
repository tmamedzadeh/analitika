import { sql } from "drizzle-orm";

export type CurrentUser = {
  id: "admin";
};

export function getCurrentUser(): CurrentUser {
  return { id: "admin" };
}

export function accessFilter(_user: CurrentUser = getCurrentUser()) {
  return sql.raw("true");
}
