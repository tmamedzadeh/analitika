import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { briefExcerpt } from "@/lib/briefs";
import { directionIdSchema } from "@/lib/directions";
import { getDb } from "@/server/db";
import { documentAccessFilter, documentManagementFilter } from "@/server/db/access";
import { attachments, documents, documentImageUploads } from "@/server/db/schema";
import { readServerEnv } from "@/server/env";
import { lexicalSearchSql, afterSearchScore } from "@/server/search/sql";

import { periodShape } from "@/lib/period";
import { reliabilityFilterShape } from "@/lib/analytics";
import { documentDateCondition, documentReliabilityConditions } from "@/server/analytics/filters";

export const DOCUMENT_PAGE_SIZE = 12;
export const documentListSchema = z.object({
  ...periodShape,
  period: periodShape.period.default("all"),
  ...reliabilityFilterShape,
  query: z.string().trim().max(200).default(""),
  direction: directionIdSchema.optional(),
  cursor: z
    .object({
      createdAt: z.string().datetime(),
      id: z.string().uuid(),
      score: z.number().int().min(0).max(20000).optional(),
    })
    .nullable()
    .default(null),
});

export function documentListConditions(filters: z.infer<typeof documentListSchema>) {
  const conditions = [
    documentAccessFilter(),
    documentDateCondition(filters),
    ...documentReliabilityConditions(filters),
  ];
  if (filters.direction) conditions.push(eq(documents.direction, filters.direction));
  const search = lexicalSearchSql(filters.query, { title: documents.title, body: documents.body });
  if (search.active) conditions.push(search.match);
  if (filters.cursor) {
    // Preserve PostgreSQL microseconds in the cursor; JS Date truncates them.
    const date = sql`${filters.cursor.createdAt}::timestamptz`;
    const after = or(
      lt(documents.createdAt, date),
      and(eq(documents.createdAt, date), lt(documents.id, filters.cursor.id)),
    )!;
    conditions.push(
      search.active ? afterSearchScore(search.score, filters.cursor.score ?? 0, after) : after,
    );
  }
  return conditions;
}

export async function listDocumentsPage(filters: z.infer<typeof documentListSchema>) {
  const search = lexicalSearchSql(filters.query, { title: documents.title, body: documents.body });
  const rows = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      docDate: documents.docDate,
      createdAt: sql<string>`to_char(${documents.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      direction: documents.direction,
      classification: documents.classification,
      status: documents.status,
      preview: sql<string>`left(${documents.body}, 1200)`,
      hasAttachments: sql<boolean>`exists (select 1 from ${attachments} where ${attachments.documentId} = ${documents.id})`,
      canManage: sql<boolean>`(${documentManagementFilter()})`,
      score: search.score.as("search_score"),
    })
    .from(documents)
    .where(and(...documentListConditions(filters)))
    .orderBy(
      ...(search.active ? [desc(sql`search_score`)] : []),
      desc(documents.createdAt),
      desc(documents.id),
    )
    .limit(DOCUMENT_PAGE_SIZE + 1);
  const page = rows.slice(0, DOCUMENT_PAGE_SIZE);
  const imageStatuses = new Map<string, string>();
  if (readServerEnv().DOCUMENT_IMAGE_UPLOADS_ENABLED === "true" && page.length) {
    const slots = await getDb()
      .select({ documentId: documentImageUploads.documentId, state: documentImageUploads.state })
      .from(documentImageUploads)
      .innerJoin(documents, eq(documentImageUploads.documentId, documents.id))
      .where(
        and(
          inArray(
            documentImageUploads.documentId,
            page.map((row) => row.id),
          ),
          documentAccessFilter(),
        ),
      );
    for (const row of page) {
      const states = slots.filter((slot) => slot.documentId === row.id).map((slot) => slot.state);
      imageStatuses.set(
        row.id,
        states.includes("checking")
          ? "Yoxlanılır"
          : states.some((state) => state === "pending" || state === "uploading")
            ? "Yüklənir"
            : states.some((state) => state === "failed" || state === "expired")
              ? "Xəta"
              : row.hasAttachments
                ? "Hazırdır"
                : "Şəkil yoxdur",
      );
    }
  }
  const last = page.at(-1);
  return {
    items: page.map(({ score: _score, ...row }) => ({
      ...row,
      preview: briefExcerpt(row.preview),
      ...(imageStatuses.has(row.id) ? { imageStatus: imageStatuses.get(row.id) } : {}),
    })),
    nextCursor:
      rows.length > DOCUMENT_PAGE_SIZE && last
        ? {
            createdAt: last.createdAt,
            id: last.id,
            ...(search.active ? { score: Number(last.score) } : {}),
          }
        : null,
  };
}
