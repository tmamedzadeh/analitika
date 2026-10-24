import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { analyticsFiltersSchema, parseHistoryFilters, citedSourceNumbers } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { canAccessClassification, getCurrentUser } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  briefAccessFilter,
  classificationAccessFilter,
  documentAccessFilter,
} from "@/server/db/access";
import { analyticsQueries, appUsers, chunks, dailyBriefs, documents } from "@/server/db/schema";
import { readServerEnv } from "@/server/env";
import type { AnalyticsFilters, AnalyticsSource, AnalyticsSourcePreview } from "@/lib/analytics";
import { hasCommittedDocumentIndex } from "./filters";
import { hasCommittedBriefIndex } from "../briefs/index-state";
import type { InfoCredibility, SourceReliability } from "@/lib/reliability";
import { validateCitations } from "./citations";
import {
  contextChunkProjection,
  contextChunks,
  contextFingerprint,
  contextFingerprintSchema,
  CONTEXT_FINGERPRINT_LIMIT,
  type AnalyticsContext,
} from "./context-identity";

const sourceSnapshotSchema = z.object({
  n: z.number().int().positive(),
  documentId: z.string().uuid().nullable().default(null),
  briefId: z.string().uuid().nullable().default(null),
  // IDs only: previews are read from the current authorized chunk, never copied into history.
  chunkId: z.string().uuid().optional(),
  // Missing legacy display metadata is never evidence of source availability.
  // Resolve it from the authorized parent instead of trusting the saved label.
  title: z.string().default(""),
  caption: z.string().default(""),
  usedInAnswer: z.boolean().default(false),
  maxClassification: z.string().default("unknown"),
  model: z.string().default(""),
  durationMs: z.number().int().nonnegative().default(0),
  createdAt: z.string().default(""),
  // Private provenance only: no text, citation number or standalone source entry.
  contextChunks: z.array(contextFingerprintSchema).min(1).max(CONTEXT_FINGERPRINT_LIMIT).optional(),
});

export type AnalyticsHistorySource = Omit<z.infer<typeof sourceSnapshotSchema>, "contextChunks"> & {
  available: boolean;
  preview?: AnalyticsSourcePreview | null;
};

export function buildAnalyticsHistorySnapshot(
  sources: AnalyticsSource[],
  answer: string,
  model: string,
  durationMs: number,
  createdAt: Date,
  context?: AnalyticsContext,
) {
  const cited = citedSourceNumbers(answer);
  const snapshots = sources.map((source, index) => ({
    n: source.n,
    documentId: source.documentId,
    briefId: source.briefId,
    chunkId: source.chunkId,
    title: source.title,
    caption: source.sectionTitle,
    usedInAnswer: cited.has(source.n),
    maxClassification: source.classification ?? "open",
    model,
    durationMs,
    createdAt: createdAt.toISOString(),
    ...(index === 0 && context
      ? { contextChunks: contextChunks(context).map(contextFingerprint) }
      : {}),
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
      filters: analyticsFiltersSchema.parse(input.filters),
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
  return getDb().transaction(async (db) => {
    // Serialize preview reads against account/clearance and source revocation.
    const [activeUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
      .for("share")
      .limit(1);
    if (!activeUser) return null;
    const [row] = await db
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
    if (!parsedSources.success) return null;
    const snapshots = parsedSources.data;
    // A citation number must identify exactly one parent and one saved fragment.
    if (
      new Set(snapshots.map((source) => source.n)).size !== snapshots.length ||
      snapshots.some((source) => source.documentId && source.briefId)
    )
      return null;
    const resolved: AnalyticsHistorySource[] = [];
    for (const source of snapshots) {
      let available = false;
      let preview: AnalyticsSourcePreview | null = null;
      let metadata: Pick<
        AnalyticsSourcePreview,
        | "sourceKind"
        | "title"
        | "docDate"
        | "briefDate"
        | "direction"
        | "sourceReliability"
        | "infoCredibility"
        | "classification"
      > | null = null;
      if (source.documentId) {
        const [document] = await db
          .select({
            title: documents.title,
            docDate: documents.docDate,
            direction: documents.direction,
            sourceReliability: documents.sourceReliability,
            infoCredibility: documents.infoCredibility,
            classification: documents.classification,
          })
          .from(documents)
          .where(and(eq(documents.id, source.documentId), documentAccessFilter(user)))
          .for("share")
          .limit(1);
        available = Boolean(document);
        if (document)
          metadata = {
            ...document,
            sourceKind: "document",
            briefDate: null,
            sourceReliability: document.sourceReliability as SourceReliability,
            infoCredibility: document.infoCredibility as InfoCredibility,
          };
      } else if (source.briefId) {
        const [brief] = await db
          .select({
            title: dailyBriefs.title,
            briefDate: dailyBriefs.briefDate,
            classification: sql<string>`'open'`,
          })
          .from(dailyBriefs)
          .where(
            and(
              eq(dailyBriefs.id, source.briefId),
              eq(dailyBriefs.status, "published"),
              briefAccessFilter(user),
            ),
          )
          .for("share")
          .limit(1);
        available = Boolean(brief);
        if (brief)
          metadata = {
            ...brief,
            sourceKind: "brief",
            docDate: null,
            direction: null,
            sourceReliability: null,
            infoCredibility: null,
          };
      }
      if (available && metadata && source.chunkId) {
        // Bind the saved citation to its exact current parent and committed index.
        const [chunk] = await db
          .select({
            id: chunks.id,
            sectionTitle: chunks.sectionTitle,
            quote: sql<string>`left(${chunks.text}, 360)`,
            isTable: chunks.isTable,
          })
          .from(chunks)
          .where(
            and(
              eq(chunks.id, source.chunkId),
              source.documentId
                ? and(
                    eq(chunks.documentId, source.documentId),
                    sql`exists (select 1 from ${documents} where ${documents.id} = ${source.documentId} and ${hasCommittedDocumentIndex()})`,
                  )
                : and(
                    eq(chunks.briefId, source.briefId!),
                    sql`exists (select 1 from ${dailyBriefs} where ${dailyBriefs.id} = ${source.briefId} and ${hasCommittedBriefIndex()})`,
                  ),
            ),
          )
          .for("share")
          .limit(1);
        if (chunk)
          preview = {
            ...metadata,
            n: source.n,
            chunkId: chunk.id,
            documentId: source.documentId,
            briefId: source.briefId,
            sectionTitle: chunk.sectionTitle,
            quote: chunk.quote,
            isTable: chunk.isTable,
            attachmentCount: 0,
          };
        else available = false;
      } else if (available && metadata) {
        // Legacy snapshots can still link to their currently authorized parent.
        // An empty ID/excerpt explicitly means that no exact chunk was verified.
        preview = {
          ...metadata,
          n: source.n,
          chunkId: "",
          documentId: source.documentId,
          briefId: source.briefId,
          sectionTitle: "",
          quote: "",
          isTable: false,
          attachmentCount: 0,
        };
      }
      const { contextChunks: _privateContext, ...publicSource } = source;
      resolved.push({
        ...publicSource,
        available,
        preview: available ? preview : null,
        ...(available
          ? {
              title: metadata!.title,
              caption: preview?.sectionTitle ?? "",
              maxClassification: metadata!.classification ?? source.maxClassification,
            }
          : {
              documentId: null,
              briefId: null,
              usedInAnswer: false,
              title: az.analytics.sourceUnavailable,
              caption: "",
              chunkId: undefined,
            }),
      });
    }
    const filters = parseHistoryFilters(row.filters);
    if (!filters.success) return null;
    // All authorized parent locks above remain held. One bounded query checks the
    // complete generation context, even when expansion has since been switched OFF.
    const fingerprints = snapshots.flatMap((source) => source.contextChunks ?? []);
    let unavailableContext = false;
    if (fingerprints.length) {
      unavailableContext =
        fingerprints.length > CONTEXT_FINGERPRINT_LIMIT ||
        new Set(fingerprints.map((item) => item.id)).size !== fingerprints.length ||
        resolved.some((source) => !source.available) ||
        fingerprints.some(
          (chunk) =>
            !resolved.some(
              (source) =>
                source.available &&
                source.documentId === chunk.documentId &&
                source.briefId === chunk.briefId,
            ),
        );
      if (!unavailableContext) {
        const current = await db
          .select(contextChunkProjection)
          .from(chunks)
          .where(
            inArray(
              chunks.id,
              fingerprints.map((item) => item.id),
            ),
          )
          .for("share");
        const byId = new Map(current.map((chunk) => [chunk.id, contextFingerprint(chunk)]));
        unavailableContext = fingerprints.some((item) => byId.get(item.id)?.digest !== item.digest);
      }
    }
    // Child source reads can outlast a clearance/role change. Recheck query metadata last.
    const [stillVisible] = await db
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
    const verifiedSources = resolved.flatMap((source) =>
      source.available && source.chunkId && source.preview ? [source.preview] : [],
    );
    const unavailableCitation =
      unavailableContext ||
      resolved.some((source) => !source.available || !source.chunkId) ||
      validateCitations(row.answer ?? "", verifiedSources).incomplete;
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
  });
}

export async function pruneAnalyticsHistory(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - readServerEnv().ANALYTICS_HISTORY_DAYS * 86_400_000);
  const removed = await getDb()
    .delete(analyticsQueries)
    .where(lt(analyticsQueries.createdAt, cutoff))
    .returning({ id: analyticsQueries.id });
  return removed.length;
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
    sql`not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(${analyticsQueries.sources}) = 'array'
          then ${analyticsQueries.sources} else '[]'::jsonb end
      ) as source
      where source ->> 'briefId' is not null
        and not exists (
          select 1 from ${dailyBriefs}
          where ${dailyBriefs.id}::text = source ->> 'briefId'
            and ${dailyBriefs.status} = 'published'
            and ${briefAccessFilter({ id: userId })}
        )
    )`,
  );
}
