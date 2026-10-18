import { and, desc, eq, gte, inArray, ilike, lt, lte, or, sql } from "drizzle-orm";

import {
  briefExcerpt,
  BRIEF_PAGE_SIZE,
  getBakuDate,
  getWeekStartDate,
  type Brief,
  type BriefListItem,
} from "@/lib/briefs";
import { accessFilter } from "@/server/db/access";
import { getDb } from "@/server/db";
import { briefAttachments, chunks, dailyBriefs } from "@/server/db/schema";
import { getStorage } from "@/server/storage/s3";

export type BriefListFilters = {
  query: string;
  period: "all" | "week" | "month";
  month: string;
  cursor: string | null;
};

function briefWindow(filters: Pick<BriefListFilters, "period" | "month">, now = new Date()) {
  const today = getBakuDate(now);
  if (/^\d{4}-\d{2}$/.test(filters.month)) {
    const monthStart = new Date(`${filters.month}-01T00:00:00.000Z`);
    const nextMonth = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCDate(0);
    return { from: `${filters.month}-01`, through: nextMonth.toISOString().slice(0, 10) };
  }
  if (filters.period === "week") return { from: getWeekStartDate(today), through: today };
  if (filters.period === "month") return { from: `${today.slice(0, 7)}-01`, through: today };
  return null;
}

export function buildBriefListConditions(filters: BriefListFilters) {
  const conditions = [accessFilter()];
  const window = briefWindow(filters);
  if (window) {
    conditions.push(gte(dailyBriefs.briefDate, window.from));
    conditions.push(lte(dailyBriefs.briefDate, window.through));
  }
  if (filters.cursor) conditions.push(lt(dailyBriefs.briefDate, filters.cursor));
  const query = filters.query.trim();
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(dailyBriefs.title, pattern),
        ilike(dailyBriefs.body, pattern),
        sql`${dailyBriefs.title} % ${query}`,
        sql`${dailyBriefs.body} % ${query}`,
      )!,
    );
  }
  return conditions;
}

export async function listBriefsPage(filters: BriefListFilters): Promise<{
  items: BriefListItem[];
  nextCursor: string | null;
}> {
  const db = getDb();
  const rows = await db
    .select({
      id: dailyBriefs.id,
      date: dailyBriefs.briefDate,
      title: dailyBriefs.title,
      body: dailyBriefs.body,
      status: dailyBriefs.status,
      indexStatus: dailyBriefs.indexStatus,
      indexProgress: dailyBriefs.indexProgress,
      author: dailyBriefs.authorId,
      publishedAt: dailyBriefs.publishedAt,
    })
    .from(dailyBriefs)
    .where(and(...buildBriefListConditions(filters)))
    .orderBy(desc(dailyBriefs.briefDate))
    .limit(BRIEF_PAGE_SIZE + 1);

  const hasMore = rows.length > BRIEF_PAGE_SIZE;
  const pageRows = rows.slice(0, BRIEF_PAGE_SIZE);
  const ids = pageRows.map((row) => row.id);
  const photoCounts = ids.length
    ? await db
        .select({ briefId: briefAttachments.briefId, total: sql<number>`count(*)` })
        .from(briefAttachments)
        .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
        .where(and(inArray(briefAttachments.briefId, ids), accessFilter()))
        .groupBy(briefAttachments.briefId)
    : [];
  const countByBrief = new Map(photoCounts.map((row) => [row.briefId, Number(row.total)]));
  const items: BriefListItem[] = pageRows.map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    excerpt: briefExcerpt(row.body),
    status: row.status as BriefListItem["status"],
    indexStatus: row.indexStatus as BriefListItem["indexStatus"],
    indexProgress: briefProgress(row.indexProgress),
    author: row.author,
    photoCount: countByBrief.get(row.id) ?? 0,
  }));
  return {
    items,
    nextCursor: hasMore ? (pageRows.at(-1)?.date ?? null) : null,
  };
}

export async function getBriefDetails(
  briefId: string,
  chunkId?: string,
): Promise<{
  brief: Brief;
  previousId: string | null;
  nextId: string | null;
} | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.id, briefId), accessFilter()))
    .limit(1);
  if (!row) return null;

  const files = await db
    .select()
    .from(briefAttachments)
    .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
    .where(and(eq(briefAttachments.briefId, briefId), accessFilter()))
    .orderBy(briefAttachments.ord);
  const storage = getStorage();
  const photos = await Promise.all(
    files.map(async ({ brief_attachments: file }) => ({
      id: file.id,
      name: file.name,
      url: await storage.getSignedUrl(file.storageKey, 3600),
    })),
  );
  const [highlightChunk] = chunkId
    ? await db
        .select({ id: chunks.id, start: chunks.charStart, end: chunks.charEnd })
        .from(chunks)
        .innerJoin(dailyBriefs, eq(chunks.briefId, dailyBriefs.id))
        .where(and(eq(chunks.id, chunkId), eq(chunks.briefId, briefId), accessFilter()))
        .limit(1)
    : [];
  // Find neighbors by date rather than assuming consecutive calendar days.
  const [older] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(and(sql`${dailyBriefs.briefDate} < ${row.briefDate}`, accessFilter()))
    .orderBy(desc(dailyBriefs.briefDate))
    .limit(1);
  const [newer] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(and(sql`${dailyBriefs.briefDate} > ${row.briefDate}`, accessFilter()))
    .orderBy(dailyBriefs.briefDate)
    .limit(1);
  return {
    brief: {
      id: row.id,
      date: row.briefDate,
      title: row.title,
      body: row.body,
      status: row.status as Brief["status"],
      indexStatus: row.indexStatus as Brief["indexStatus"],
      indexProgress: briefProgress(row.indexProgress),
      author: row.authorId,
      photos,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      highlight: highlightChunk
        ? { chunkId: highlightChunk.id, start: highlightChunk.start, end: highlightChunk.end }
        : null,
    },
    previousId: older?.id ?? null,
    nextId: newer?.id ?? null,
  };
}

function briefProgress(value: unknown): Brief["indexProgress"] {
  const progress = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    percent: typeof progress["percent"] === "number" ? progress["percent"] : 0,
    totalChunks: typeof progress["totalChunks"] === "number" ? progress["totalChunks"] : 0,
    completedChunks:
      typeof progress["completedChunks"] === "number" ? progress["completedChunks"] : 0,
  };
}
