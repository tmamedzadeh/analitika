import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { briefDateSchema, briefIdSchema } from "./briefs";
import {
  discardBriefUploads as discardServerBriefUploads,
  prepareBriefUploadsSchema,
  prepareBriefUploadUrls,
  removeBrief,
  saveBriefRecord,
  saveBriefSchema,
} from "@/server/briefs/mutations";
import { getBriefDetails, listBriefsPage } from "@/server/briefs/queries";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { appUsers } from "@/server/db/schema";
import { allowedClassifications, getCurrentUser, type Clearance } from "@/server/auth";

export const getBriefFormContext = createServerFn({ method: "GET" }).handler(async () => {
  const [actor] = await getDb()
    .select({ role: appUsers.role, clearance: appUsers.clearance })
    .from(appUsers)
    .where(and(eq(appUsers.id, getCurrentUser().id), eq(appUsers.active, true)))
    .limit(1);
  return {
    classifications: actor
      ? allowedClassifications({ clearance: actor.clearance as Clearance })
      : [],
    canDeclassify: actor?.role === "admin",
  };
});

const listInputSchema = z.object({
  query: z.string().trim().max(200).default(""),
  period: z.enum(["all", "week", "month"]).default("all"),
  month: z
    .string()
    .regex(/^$|^\d{4}-\d{2}$/)
    .default(""),
  cursor: z
    .object({
      date: briefDateSchema,
      id: briefIdSchema,
      score: z.number().int().min(0).max(20000).optional(),
    })
    .nullable()
    .default(null),
});
const briefIdInputSchema = z.object({ briefId: briefIdSchema, chunkId: briefIdSchema.optional() });
const discardInputSchema = z.object({
  briefId: briefIdSchema,
  keys: z.array(z.string().min(1).max(600)).max(10),
});

export const listBriefs = createServerFn({ method: "GET" })
  .validator(listInputSchema)
  .handler(async ({ data }) => listBriefsPage(data));

export const getBrief = createServerFn({ method: "GET" })
  .validator(briefIdInputSchema)
  .handler(async ({ data }) => getBriefDetails(data.briefId, data.chunkId));

export const prepareBriefUploads = createServerFn({ method: "POST" })
  .validator(prepareBriefUploadsSchema)
  .handler(async ({ data }) => prepareBriefUploadUrls(data));

export const saveBrief = createServerFn({ method: "POST" })
  .validator(saveBriefSchema)
  .handler(async ({ data }) => saveBriefRecord(data));

export const discardBriefUploads = createServerFn({ method: "POST" })
  .validator(discardInputSchema)
  .handler(async ({ data }) => {
    await discardServerBriefUploads(data);
    return { ok: true };
  });

export const deleteBrief = createServerFn({ method: "POST" })
  .validator(briefIdInputSchema)
  .handler(async ({ data }) => {
    const cleanup = await removeBrief(data.briefId);
    return { ok: true, ...cleanup };
  });
