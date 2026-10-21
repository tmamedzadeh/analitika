import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

import {
  briefExcerpt,
  BRIEF_PAGE_SIZE,
  getBakuDate,
  getWeekStartDate,
  type BriefCursor,
  type Brief,
  type BriefListItem,
} from "@/lib/briefs";
import { accessFilter } from "@/server/db/access";
import { getDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { briefAttachments, chunks, dailyBriefs } from "@/server/db/schema";
import { afterBriefPosition, beforeBriefPosition } from "./pagination";
import { hasCommittedBriefIndex } from "./index-state";

export type BriefListFilters = {
  query: string;
  period: "all" | "week" | "month";
  month: string;
  cursor: BriefCursor | null;
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

export function normalizeBriefSearch(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("az-Latn-AZ")
    .normalize("NFC");
}

export function buildBriefSearchQuery(value: string): string {
  return normalizeBriefSearch(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((term) => `'${term.replaceAll("'", "''")}'`)
    .join(" & ");
}

export function buildBriefListConditions(filters: BriefListFilters) {
  const conditions = [accessFilter()];
  const window = briefWindow(filters);
  if (window) {
    conditions.push(gte(dailyBriefs.briefDate, window.from));
    conditions.push(lte(dailyBriefs.briefDate, window.through));
  }
  if (filters.cursor) conditions.push(afterBriefPosition(filters.cursor));
  const query = buildBriefSearchQuery(filters.query);
  if (query) {
    conditions.push(
      sql`to_tsvector('simple'::regconfig, lower(translate(normalize(${dailyBriefs.title} || ' || ' || ${dailyBriefs.body}, NFC), 'ƏİIŞÇĞÖÜ', 'əiışçğöü'))) @@ to_tsquery('simple'::regconfig, ${query})`,
    );
  }
  return conditions;
}

export async function listBriefsPage(filters: BriefListFilters): Promise<{
  items: BriefListItem[];
  nextCursor: BriefCursor | null;
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
      publishedAt: dailyBriefs.publishedAt,
    })
    .from(dailyBriefs)
    .where(and(...buildBriefListConditions(filters)))
    .orderBy(desc(dailyBriefs.briefDate), desc(dailyBriefs.id))
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
  const featuredRow = pageRows.find((row) => row.date === getBakuDate()) ?? pageRows[0];
  const [coverFile] = featuredRow
    ? await db
        .select({ id: briefAttachments.id })
        .from(briefAttachments)
        .innerJoin(dailyBriefs, eq(briefAttachments.briefId, dailyBriefs.id))
        .where(and(eq(briefAttachments.briefId, featuredRow.id), accessFilter()))
        .orderBy(briefAttachments.ord)
        .limit(1)
    : [];
  const coverUrl =
    coverFile && featuredRow ? `/api/attachments/brief/${featuredRow.id}/${coverFile.id}` : null;
  const items: BriefListItem[] = pageRows.map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    excerpt: briefExcerpt(row.body),
    status: row.status as BriefListItem["status"],
    indexStatus: row.indexStatus as BriefListItem["indexStatus"],
    indexProgress: briefProgress(row.indexProgress),
    photoCount: countByBrief.get(row.id) ?? 0,
    coverUrl: row.id === featuredRow?.id ? coverUrl : null,
  }));
  return {
    items,
    nextCursor: hasMore
      ? (() => {
          const last = pageRows.at(-1);
          return last ? { date: last.date, id: last.id } : null;
        })()
      : null,
  };
}

export async function getBriefDetails(
  briefId: string,
  chunkId?: string,
): Promise<{
  brief: Brief;
  previousId: string | null;
  nextId: string | null;
  canEdit: boolean;
  canDelete: boolean;
} | null> {
  const db = getDb();
  const user = getCurrentUser();
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
  const photos = files.map(({ brief_attachments: file }) => ({
    id: file.id,
    name: file.name,
    url: `/api/attachments/brief/${briefId}/${file.id}`,
  }));
  const [highlightChunk] = chunkId
    ? await db
        .select({ id: chunks.id, start: chunks.charStart, end: chunks.charEnd })
        .from(chunks)
        .innerJoin(dailyBriefs, eq(chunks.briefId, dailyBriefs.id))
        .where(
          and(
            eq(chunks.id, chunkId),
            eq(chunks.briefId, briefId),
            hasCommittedBriefIndex(),
            accessFilter(),
          ),
        )
        .limit(1)
    : [];
  const position = { date: row.briefDate, id: row.id };
  // Keep detail navigation aligned with the newest-first list, including ties on a date.
  const [older] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(and(afterBriefPosition(position), accessFilter()))
    .orderBy(desc(dailyBriefs.briefDate), desc(dailyBriefs.id))
    .limit(1);
  const [newer] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(and(beforeBriefPosition(position), accessFilter()))
    .orderBy(asc(dailyBriefs.briefDate), asc(dailyBriefs.id))
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
      photos,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      highlight: highlightChunk
        ? { chunkId: highlightChunk.id, start: highlightChunk.start, end: highlightChunk.end }
        : null,
    },
    previousId: older?.id ?? null,
    nextId: newer?.id ?? null,
    canEdit: user.role === "admin" || row.authorId === user.id,
    canDelete: user.role === "admin",
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
