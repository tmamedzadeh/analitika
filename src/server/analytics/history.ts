import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { analyticsFiltersSchema } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { canAccessClassification, getCurrentUser, type Clearance } from "@/server/auth";
import { getDb } from "@/server/db";
import { accessFilter, documentAccessFilter } from "@/server/db/access";
import { analyticsQueries, appUsers, dailyBriefs, documents } from "@/server/db/schema";
import { readServerEnv } from "@/server/env";
import type { AnalyticsFilters, AnalyticsSource } from "@/lib/analytics";

const sourceSnapshotSchema = z.object({
  n: z.number().int().positive(),
  documentId: z.string().uuid().nullable(),
  briefId: z.string().uuid().nullable(),
  title: z.string(),
  caption: z.string(),
  usedInAnswer: z.boolean(),
  maxClassification: z.string(),
  model: z.string(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export type AnalyticsHistorySource = z.infer<typeof sourceSnapshotSchema> & {
  available: boolean;
};

export function buildAnalyticsHistorySnapshot(
  sources: AnalyticsSource[],
  answer: string,
  model: string,
  durationMs: number,
  createdAt: Date,
) {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  const snapshots = sources.map((source) => ({
    n: source.n,
    documentId: source.documentId,
    briefId: source.briefId,
    title: source.title,
    caption: source.sectionTitle,
    usedInAnswer: cited.has(source.n),
    maxClassification: source.classification ?? "open",
    model,
    durationMs,
    createdAt: createdAt.toISOString(),
  }));
  const classificationOrder = ["open", "secret", "top_secret", "special"];
  const maxClassification = snapshots.reduce(
    (maximum, source) =>
      classificationOrder.indexOf(source.maxClassification) > classificationOrder.indexOf(maximum)
        ? source.maxClassification
        : maximum,
    "open",
  );
  return { snapshots, maxClassification };
}

export async function createAnalyticsHistoryRecord(input: {
  id: string;
  createdBy: string;
  query: string;
  filters: AnalyticsFilters;
}): Promise<void> {
  await getDb().insert(analyticsQueries).values({
    id: input.id,
    createdBy: input.createdBy,
    query: input.query,
    filters: input.filters,
    status: "running",
    answer: null,
    sources: [],
    maxClassification: "open",
  });
}

export async function updateAnalyticsHistoryRecord(
  id: string,
  input: {
    status: "done" | "incomplete" | "failed" | "cancelled";
    answer?: string | null;
    sources?: ReturnType<typeof buildAnalyticsHistorySnapshot>["snapshots"];
    maxClassification?: string;
    model?: string;
    durationMs?: number;
  },
): Promise<void> {
  const condition =
    input.status === "cancelled"
      ? eq(analyticsQueries.id, id)
      : and(eq(analyticsQueries.id, id), eq(analyticsQueries.status, "running"));
  await getDb()
    .update(analyticsQueries)
    .set({ ...input, updatedAt: new Date() })
    .where(condition);
}

export async function listAnalyticsHistory(): Promise<
  {
    id: string;
    query: string;
    status: string;
    createdAt: string;
    durationMs: number | null;
    author?: string;
  }[]
> {
  const user = getCurrentUser();
  const rows = await getDb()
    .select({
      id: analyticsQueries.id,
      query: analyticsQueries.query,
      status: analyticsQueries.status,
      createdAt: analyticsQueries.createdAt,
      durationMs: analyticsQueries.durationMs,
      author: appUsers.username,
    })
    .from(analyticsQueries)
    .innerJoin(appUsers, eq(analyticsQueries.createdBy, appUsers.id))
    .where(user.role === "admin" ? undefined : eq(analyticsQueries.createdBy, user.id))
    .orderBy(desc(analyticsQueries.createdAt))
    .limit(20);
  return rows.map(({ createdAt, author, ...row }) => ({
    ...row,
    createdAt: createdAt.toISOString(),
    ...(user.role === "admin" ? { author } : {}),
  }));
}

export async function getAnalyticsHistoryRecord(id: string) {
  const user = getCurrentUser();
  const [row] = await getDb()
    .select({
      id: analyticsQueries.id,
      createdBy: analyticsQueries.createdBy,
      query: analyticsQueries.query,
      filters: analyticsQueries.filters,
      status: analyticsQueries.status,
      answer: analyticsQueries.answer,
      sources: analyticsQueries.sources,
      maxClassification: analyticsQueries.maxClassification,
      model: analyticsQueries.model,
      durationMs: analyticsQueries.durationMs,
      createdAt: analyticsQueries.createdAt,
      author: appUsers.username,
    })
    .from(analyticsQueries)
    .innerJoin(appUsers, eq(analyticsQueries.createdBy, appUsers.id))
    .where(
      and(
        eq(analyticsQueries.id, id),
        user.role === "admin" ? undefined : eq(analyticsQueries.createdBy, user.id),
      ),
    )
    .limit(1);
  if (!row || !canAccessClassification(user, row.maxClassification)) return null;
  const parsedSources = z.array(sourceSnapshotSchema).safeParse(row.sources);
  const snapshots = parsedSources.success ? parsedSources.data : [];
  const resolved = await Promise.all(
    snapshots.map(async (source): Promise<AnalyticsHistorySource> => {
      let available = false;
      if (source.documentId) {
        const [document] = await getDb()
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.id, source.documentId), documentAccessFilter(user)))
          .limit(1);
        available = Boolean(document);
      } else if (source.briefId) {
        const [brief] = await getDb()
          .select({ id: dailyBriefs.id })
          .from(dailyBriefs)
          .where(and(eq(dailyBriefs.id, source.briefId), accessFilter(user)))
          .limit(1);
        available = Boolean(brief);
      }
      return {
        ...source,
        available,
        ...(available ? {} : { title: az.analytics.sourceUnavailable, caption: "" }),
      };
    }),
  );
  const filters = analyticsFiltersSchema.safeParse(row.filters);
  if (!filters.success) return null;
  return {
    id: row.id,
    query: row.query,
    filters: filters.data,
    status: row.status,
    answer: row.answer ?? "",
    sources: resolved,
    model: row.model,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    ...(user.role === "admin" ? { author: row.author } : {}),
  };
}

export async function pruneAnalyticsHistory(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - readServerEnv().ANALYTICS_HISTORY_DAYS * 86_400_000);
  const removed = await getDb()
    .delete(analyticsQueries)
    .where(lt(analyticsQueries.createdAt, cutoff))
    .returning({ id: analyticsQueries.id });
  return removed.length;
}

export function analyticsHistoryOwnerCondition(userId: string, isAdmin: boolean) {
  return isAdmin ? undefined : eq(analyticsQueries.createdBy, userId);
}

export function analyticsHistoryClassificationAllowed(
  clearance: Clearance,
  value: string,
): boolean {
  return canAccessClassification({ clearance }, value);
}
