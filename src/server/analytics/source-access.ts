import { and, eq, inArray } from "drizzle-orm";

import type { AnalyticsSource } from "@/lib/analytics";
import { getDb } from "@/server/db";
import { accessFilter, documentAccessFilter } from "@/server/db/access";
import { appUsers, chunks, dailyBriefs, documents } from "@/server/db/schema";
import { hasCommittedDocumentIndex } from "./filters";
import { hasCommittedBriefIndex } from "../briefs/index-state";

export async function recheckAnalyticsSourceAccess(
  sources: readonly AnalyticsSource[],
  userId: string,
): Promise<AnalyticsSource[]> {
  return (await withAnalyticsSourceAccess(sources, userId, (available) => available)).sources;
}

export async function withAnalyticsCandidateAccess<T>(
  documentIds: readonly string[],
  briefIds: readonly string[],
  userId: string,
  rerank: (access: {
    documentIds: ReadonlySet<string>;
    briefIds: ReadonlySet<string>;
    chunkIds: ReadonlySet<string>;
  }) => T | Promise<T>,
  candidateChunkIds: readonly string[] = [],
): Promise<T> {
  return getDb().transaction(async (transaction) => {
    const [activeUser] = await transaction
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.active, true)))
      .for("share")
      .limit(1);
    if (!activeUser)
      return rerank({ documentIds: new Set(), briefIds: new Set(), chunkIds: new Set() });

    const [documentsAllowed, briefsAllowed] = await Promise.all([
      documentIds.length
        ? transaction
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                inArray(documents.id, [...documentIds]),
                hasCommittedDocumentIndex(),
                documentAccessFilter({ id: userId }),
              ),
            )
            .for("share")
        : Promise.resolve([]),
      briefIds.length
        ? transaction
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(
              and(
                inArray(dailyBriefs.id, [...briefIds]),
                eq(dailyBriefs.status, "published"),
                hasCommittedBriefIndex(),
                accessFilter({ id: userId }),
              ),
            )
            .for("share")
        : Promise.resolve([]),
    ]);
    const currentChunks = candidateChunkIds.length
      ? await transaction
          .select({ id: chunks.id })
          .from(chunks)
          .where(inArray(chunks.id, [...candidateChunkIds]))
          .for("share")
      : [];
    return rerank({
      documentIds: new Set(documentsAllowed.map((document) => document.id)),
      briefIds: new Set(briefsAllowed.map((brief) => brief.id)),
      chunkIds: new Set(currentChunks.map((chunk) => chunk.id)),
    });
  });
}

/** Run a brief publication step while live user/document rows are locked against revocation. */
export async function withAnalyticsSourceAccess<T>(
  sources: readonly AnalyticsSource[],
  userId: string,
  publish: (available: AnalyticsSource[]) => T | Promise<T>,
): Promise<{ sources: AnalyticsSource[]; value: T }> {
  if (!sources.length) return { sources: [], value: await publish([]) };
  const db = getDb();
  const documentIds = [
    ...new Set(sources.flatMap((source) => (source.documentId ? [source.documentId] : []))),
  ];
  const briefIds = [
    ...new Set(sources.flatMap((source) => (source.briefId ? [source.briefId] : []))),
  ];
  return db.transaction(async (transaction) => {
    const [activeUser] = await transaction
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.active, true)))
      .for("share")
      .limit(1);
    if (!activeUser) {
      const available: AnalyticsSource[] = [];
      return { sources: available, value: await publish(available) };
    }
    const [accessibleDocuments, accessibleBriefs] = await Promise.all([
      documentIds.length
        ? transaction
            .select({ id: documents.id, classification: documents.classification })
            .from(documents)
            .where(
              and(
                inArray(documents.id, documentIds),
                hasCommittedDocumentIndex(),
                documentAccessFilter({ id: userId }),
              ),
            )
            .for("share")
        : Promise.resolve([]),
      briefIds.length
        ? transaction
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(
              and(
                inArray(dailyBriefs.id, briefIds),
                eq(dailyBriefs.status, "published"),
                hasCommittedBriefIndex(),
                accessFilter({ id: userId }),
              ),
            )
            .for("share")
        : Promise.resolve([]),
    ]);
    const currentChunks = await transaction
      .select({
        id: chunks.id,
        documentId: chunks.documentId,
        briefId: chunks.briefId,
        text: chunks.text,
        charStart: chunks.charStart,
        charEnd: chunks.charEnd,
      })
      .from(chunks)
      .where(
        inArray(
          chunks.id,
          sources.map((source) => source.chunkId),
        ),
      )
      .for("share");
    const chunkById = new Map(currentChunks.map((chunk) => [chunk.id, chunk]));
    const documentById = new Map(accessibleDocuments.map((document) => [document.id, document]));
    const availableBriefIds = new Set(accessibleBriefs.map((brief) => brief.id));
    const available = sources
      .flatMap((source, index) => {
        const chunk = chunkById.get(source.chunkId);
        if (
          !chunk ||
          chunk.documentId !== source.documentId ||
          chunk.briefId !== source.briefId ||
          chunk.text !== source.text ||
          chunk.charStart !== source.charStart ||
          chunk.charEnd !== source.charEnd
        )
          return [];
        if (source.sourceKind === "document" && source.documentId) {
          const document = documentById.get(source.documentId);
          return document
            ? [{ ...source, n: index + 1, classification: document.classification }]
            : [];
        }
        if (
          source.sourceKind === "brief" &&
          source.briefId &&
          availableBriefIds.has(source.briefId)
        ) {
          return [{ ...source, n: index + 1, classification: "open" as const }];
        }
        return [];
      })
      .map((source, index) => ({ ...source, n: index + 1 }));
    return { sources: available, value: await publish(available) };
  });
}

export function sameAnalyticsSourceSet(
  expected: readonly AnalyticsSource[],
  actual: readonly AnalyticsSource[],
): boolean {
  if (expected.length !== actual.length) return false;
  const actualChunkIds = new Set(actual.map((source) => source.chunkId));
  return expected.every((source) => actualChunkIds.has(source.chunkId));
}
