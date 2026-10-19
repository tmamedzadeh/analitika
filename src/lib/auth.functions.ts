import { and, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { clearanceValues, getCurrentUser, requireAdmin, revokeUserSessions } from "@/server/auth";
import { hashPassword, normalizeUsername, verifyPassword } from "@/server/auth/password";
import { getDb } from "@/server/db";
import { appUsers } from "@/server/db/schema";

const usernameSchema = z.string().trim().min(1).max(50);
const passwordSchema = z.string().min(12).max(256);
const createUserSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirmation: z.string().max(256),
    clearance: z.enum(clearanceValues),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match.",
  });

const userIdSchema = z.object({ userId: z.string().uuid() });
const userClearanceSchema = userIdSchema.extend({ clearance: z.enum(clearanceValues) });
const userActiveSchema = userIdSchema.extend({ active: z.boolean() });
const resetPasswordSchema = z
  .object({
    userId: z.string().uuid(),
    password: passwordSchema,
    confirmation: z.string().max(256),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match.",
  });

export const getSettingsIdentity = createServerFn({ method: "GET" }).handler(() => {
  const user = getCurrentUser();
  return { id: user.id, username: user.username, role: user.role, clearance: user.clearance };
});

export const listManagedUsers = createServerFn({ method: "GET" }).handler(async () => {
  requireAdmin();
  const rows = await getDb()
    .select({
      id: appUsers.id,
      username: appUsers.username,
      role: appUsers.role,
      clearance: appUsers.clearance,
      active: appUsers.active,
      createdAt: appUsers.createdAt,
    })
    .from(appUsers)
    .orderBy(appUsers.username);
  return rows.map(({ createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString() }));
});

export const createManagedUser = createServerFn({ method: "POST" })
  .validator(createUserSchema)
  .handler(async ({ data }) => {
    requireAdmin();
    const username = normalizeUsername(data.username);
    if (username.length < 1 || username.length > 50) throw new Error("Invalid username.");
    try {
      const [user] = await getDb()
        .insert(appUsers)
        .values({
          id: crypto.randomUUID(),
          username,
          passwordHash: await hashPassword(data.password),
          role: "user",
          clearance: data.clearance,
          active: true,
        })
        .returning({ id: appUsers.id, username: appUsers.username });
      return user;
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("A user with that username already exists.");
      throw error;
    }
  });

export const updateManagedUserClearance = createServerFn({ method: "POST" })
  .validator(userClearanceSchema)
  .handler(async ({ data }) => {
    const actor = requireAdmin();
    if (actor.id === data.userId) throw new Error("You cannot change your own clearance.");
    const [user] = await getDb()
      .update(appUsers)
      .set({ clearance: data.clearance, updatedAt: new Date() })
      .where(eq(appUsers.id, data.userId))
      .returning({ id: appUsers.id });
    if (!user) throw new Error("User not found.");
    return { ok: true };
  });

export const updateManagedUserActive = createServerFn({ method: "POST" })
  .validator(userActiveSchema)
  .handler(async ({ data }) => {
    const actor = requireAdmin();
    if (actor.id === data.userId && !data.active)
      throw new Error("You cannot deactivate yourself.");
    const db = getDb();
    await db.transaction(async (transaction) => {
      if (!data.active) {
        const activeAdmins = await transaction
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(and(eq(appUsers.role, "admin"), eq(appUsers.active, true)))
          .for("update");
        const targetIsAdmin = activeAdmins.some((user) => user.id === data.userId);
        if (targetIsAdmin && activeAdmins.length <= 1) {
          throw new Error("The last active administrator cannot be deactivated.");
        }
      }
      const [user] = await transaction
        .update(appUsers)
        .set({ active: data.active, updatedAt: new Date() })
        .where(eq(appUsers.id, data.userId))
        .returning({ id: appUsers.id });
      if (!user) throw new Error("User not found.");
    });
    if (!data.active) await revokeUserSessions(data.userId);
    return { ok: true };
  });

export const resetManagedUserPassword = createServerFn({ method: "POST" })
  .validator(resetPasswordSchema)
  .handler(async ({ data }) => {
    requireAdmin();
    const passwordHash = await hashPassword(data["password"]);
    const [user] = await getDb()
      .update(appUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(appUsers.id, data["userId"]))
      .returning({ id: appUsers.id });
    if (!user) throw new Error("User not found.");
    await revokeUserSessions(data["userId"]);
    return { ok: true };
  });

export const changeOwnPassword = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        currentPassword: z.string().min(1).max(256),
        password: passwordSchema,
        confirmation: z.string().max(256),
      })
      .refine((value) => value.password === value.confirmation, {
        path: ["confirmation"],
        message: "Passwords do not match.",
      }),
  )
  .handler(async ({ data }) => {
    const user = getCurrentUser();
    const [record] = await getDb()
      .select({ passwordHash: appUsers.passwordHash })
      .from(appUsers)
      .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
      .limit(1);
    if (!record || !(await verifyPassword(data.currentPassword, record.passwordHash))) {
      throw new Error("Current password is incorrect.");
    }
    const passwordHash = await hashPassword(data.password);
    await getDb()
      .update(appUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(appUsers.id, user.id));
    await revokeUserSessions(user.id, user.sessionId);
    return { ok: true };
  });

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
