import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { briefExcerpt } from "@/lib/briefs";
import { directionIdSchema } from "@/lib/directions";
import { getDb } from "@/server/db";
import { documentAccessFilter, documentManagementFilter } from "@/server/db/access";
import { attachments, documents } from "@/server/db/schema";
import { buildBriefSearchQuery } from "@/server/briefs/queries";

export const DOCUMENT_PAGE_SIZE = 12;
export const documentListSchema = z.object({
  query: z.string().trim().max(200).default(""),
  direction: directionIdSchema.optional(),
  cursor: z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).nullable().default(null),
});

export function documentListConditions(filters: z.infer<typeof documentListSchema>) {
  const conditions = [documentAccessFilter()];
  if (filters.direction) conditions.push(eq(documents.direction, filters.direction));
  const query = buildBriefSearchQuery(filters.query);
  if (query) conditions.push(sql`to_tsvector('simple'::regconfig, lower(translate(normalize(${documents.title} || ' || ' || ${documents.body}, NFC), 'ƏİIŞÇĞÖÜ', 'əiışçğöü'))) @@ to_tsquery('simple'::regconfig, ${query})`);
  if (filters.cursor) {
    const date = new Date(filters.cursor.createdAt);
    conditions.push(or(lt(documents.createdAt, date), and(eq(documents.createdAt, date), lt(documents.id, filters.cursor.id)))!);
  }
  return conditions;
}

export async function listDocumentsPage(filters: z.infer<typeof documentListSchema>) {
  const rows = await getDb().select({
    id: documents.id, title: documents.title, docDate: documents.docDate,
    createdAt: documents.createdAt, direction: documents.direction,
    classification: documents.classification, status: documents.status,
    preview: sql<string>`left(${documents.body}, 1200)`,
    hasAttachments: sql<boolean>`exists (select 1 from ${attachments} where ${attachments.documentId} = ${documents.id})`,
    canManage: sql<boolean>`(${documentManagementFilter()})`,
  }).from(documents).where(and(...documentListConditions(filters)))
    .orderBy(desc(documents.createdAt), desc(documents.id)).limit(DOCUMENT_PAGE_SIZE + 1);
  const page = rows.slice(0, DOCUMENT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ ...row, preview: briefExcerpt(row.preview), createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > DOCUMENT_PAGE_SIZE && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
  };
}
