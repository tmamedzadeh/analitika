import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { analyticsFiltersSchema } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { canAccessClassification, getCurrentUser, type Clearance } from "@/server/auth";
import { getDb } from "@/server/db";
import { accessFilter, classificationAccessFilter, documentAccessFilter } from "@/server/db/access";
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
  await getDb()
    .insert(analyticsQueries)
    .values({
      id: input.id,
      createdBy: input.createdBy,
      query: input.query,
      filters: input.filters,
      status: "running",
      answer: null,
      sources: [],
      // A query can itself contain classified input before any source is retrieved.
      maxClassification: sql`(select ${appUsers.clearance} from ${appUsers} where ${appUsers.id} = ${input.createdBy} and ${appUsers.active} = true)`,
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
  const condition = and(eq(analyticsQueries.id, id), eq(analyticsQueries.status, "running"));
  await getDb()
    .update(analyticsQueries)
    .set({
      ...input,
      updatedAt: new Date(),
      ...(input.maxClassification
        ? {
            maxClassification: sql`case when array_position(array['open','secret','top_secret','special'], ${input.maxClassification}) > array_position(array['open','secret','top_secret','special'], ${analyticsQueries.maxClassification}) then ${input.maxClassification} else ${analyticsQueries.maxClassification} end`,
          }
        : {}),
    })
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
    .where(and(liveHistoryOwnerCondition(user.id), analyticsHistoryVisibilityFilter(user.id)))
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
        liveHistoryOwnerCondition(user.id),
        analyticsHistoryVisibilityFilter(user.id),
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
        ...(available
          ? {}
          : {
              documentId: null,
              briefId: null,
              usedInAnswer: false,
              title: az.analytics.sourceUnavailable,
              caption: "",
            }),
      };
    }),
  );
  const filters = analyticsFiltersSchema.safeParse(row.filters);
  if (!filters.success) return null;
  // Child source reads can outlast a clearance/role change. Recheck query metadata last.
  const [stillVisible] = await getDb()
    .select({ id: analyticsQueries.id })
    .from(analyticsQueries)
    .where(
      and(
        eq(analyticsQueries.id, id),
        liveHistoryOwnerCondition(user.id),
        analyticsHistoryVisibilityFilter(user.id),
      ),
    )
    .limit(1);
  if (!stillVisible) return null;
  const unavailableCitation = resolved.some((source) => !source.available);
  return {
    id: row.id,
    query: row.query,
    filters: filters.data,
    status: unavailableCitation ? "incomplete" : row.status,
    answer: unavailableCitation ? az.analytics.sourceUnavailable : (row.answer ?? ""),
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

function liveHistoryOwnerCondition(userId: string) {
  return or(
    eq(analyticsQueries.createdBy, userId),
    sql`exists (select 1 from ${appUsers} where ${appUsers.id} = ${userId} and ${appUsers.active} = true and ${appUsers.role} = 'admin')`,
  );
}

/** History query text and authors are metadata subject to the same live clearance boundary. */
export function analyticsHistoryVisibilityFilter(userId: string) {
  return and(
    classificationAccessFilter(analyticsQueries.maxClassification, { id: userId }),
    sql`not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(${analyticsQueries.sources}) = 'array'
          then ${analyticsQueries.sources} else '[]'::jsonb end
      ) as source
      where source ->> 'documentId' is not null
        and not exists (
          select 1 from ${documents}
          where ${documents.id}::text = source ->> 'documentId'
            and ${documentAccessFilter({ id: userId })}
        )
    )`,
  );
}

export function analyticsHistoryClassificationAllowed(
  clearance: Clearance,
  value: string,
): boolean {
  return canAccessClassification({ clearance }, value);
}
