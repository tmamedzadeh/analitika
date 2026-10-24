import { and, eq, inArray, sql } from "drizzle-orm";

import type { AnalyticsSource } from "@/lib/analytics";
import { getDb } from "@/server/db";
import { briefAccessFilter, documentAccessFilter } from "@/server/db/access";
import { appUsers, chunks, dailyBriefs, documents } from "@/server/db/schema";
import { assertLockedAnalyticsContext, type AnalyticsContextChunk } from "./context-identity";
import { hasCommittedDocumentIndex } from "./filters";
import { hasCommittedBriefIndex } from "../briefs/index-state";
import { AuthorizationError, canAccessClassification, type SessionUser } from "../auth";
import type { Clearance } from "@/lib/classification";

type AnalyticsUser = Pick<SessionUser, "id" | "clearance">;

/** The question retains its entry clearance, including when all sources are open. */
export function assertAnalyticsQuestionAccess(user: AnalyticsUser, liveClearance: string): void {
  if (!canAccessClassification({ clearance: liveClearance as Clearance }, user.clearance))
    throw new AuthorizationError();
}

/** One current-account read; no transaction or lock spans an embedding request. */
export async function assertAnalyticsQueryAccess(user: AnalyticsUser): Promise<void> {
  const [activeUser] = await getDb()
    .select({ clearance: appUsers.clearance })
    .from(appUsers)
    .where(and(eq(appUsers.id, user.id), eq(appUsers.active, true)))
    .limit(1);
  if (!activeUser) throw new AuthorizationError();
  assertAnalyticsQuestionAccess(user, activeUser.clearance);
}

export async function recheckAnalyticsSourceAccess(
  sources: readonly AnalyticsSource[],
  userId: string,
): Promise<AnalyticsSource[]> {
  return (await withAnalyticsSourceAccess(sources, userId, (available) => available)).sources;
}

/** Resolve before each provider dispatch/retry; the transaction ends before returning. */
export async function requireAnalyticsSourceAccess(
  sources: readonly AnalyticsSource[],
  user: AnalyticsUser,
  expectedContext: readonly AnalyticsContextChunk[] = [],
): Promise<AnalyticsSource[]> {
  const result = await withAnalyticsSourceAccess(
    sources,
    user.id,
    (available, liveClearance) => {
      assertAnalyticsQuestionAccess(user, liveClearance);
      if (!sameAnalyticsSourceSet(sources, available)) throw new AuthorizationError();
      return available;
    },
    expectedContext,
  );
  return result.value;
}

type Synchronous<T> = T & (T extends PromiseLike<unknown> ? never : unknown);

/** Only synchronous snapshot/publication work belongs inside these short row locks. */
export async function withAnalyticsSourceAccess<T>(
  sources: readonly AnalyticsSource[],
  userId: string,
  publish: (available: AnalyticsSource[], queryClassification: string) => Synchronous<T>,
  expectedContext: readonly AnalyticsContextChunk[] = [],
): Promise<{ sources: AnalyticsSource[]; value: T }> {
  return getDb().transaction(async (transaction) => {
    const access = await readLockedAnalyticsSources(transaction, sources, userId);
    if (expectedContext.length) {
      if (!sameAnalyticsSourceSet(sources, access.sources)) throw new AuthorizationError();
      await assertLockedAnalyticsContext(transaction, sources, expectedContext);
    }
    return { sources: access.sources, value: publish(access.sources, access.clearance) };
  });
}

export type AnalyticsTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

/** DB reads only. The caller must own the transaction; never await a provider here. */
export async function readLockedAnalyticsSources(
  transaction: AnalyticsTransaction,
  sources: readonly AnalyticsSource[],
  userId: string,
): Promise<{ sources: AnalyticsSource[]; clearance: string }> {
  const documentIds = [
    ...new Set(sources.flatMap((source) => (source.documentId ? [source.documentId] : []))),
  ];
  const briefIds = [
    ...new Set(sources.flatMap((source) => (source.briefId ? [source.briefId] : []))),
  ];
  const [activeUser] = await transaction
    .select({ id: appUsers.id, clearance: appUsers.clearance })
    .from(appUsers)
    .where(and(eq(appUsers.id, userId), eq(appUsers.active, true)))
    .for("share")
    .limit(1);
  if (!activeUser) {
    const available: AnalyticsSource[] = [];
    return { sources: available, clearance: "unknown" };
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
          .select({ id: dailyBriefs.id, classification: sql<string>`'open'` })
          .from(dailyBriefs)
          .where(
            and(
              inArray(dailyBriefs.id, briefIds),
              eq(dailyBriefs.status, "published"),
              hasCommittedBriefIndex(),
              briefAccessFilter({ id: userId }),
            ),
          )
          .for("share")
      : Promise.resolve([]),
  ]);
  const currentChunks = sources.length
    ? await transaction
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
        .for("share")
    : [];
  const chunkById = new Map(currentChunks.map((chunk) => [chunk.id, chunk]));
  const documentById = new Map(accessibleDocuments.map((document) => [document.id, document]));
  const briefById = new Map(accessibleBriefs.map((brief) => [brief.id, brief]));
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
      if (source.sourceKind === "brief" && source.briefId && briefById.has(source.briefId)) {
        return [
          {
            ...source,
            n: index + 1,
            classification: "open",
          },
        ];
      }
      return [];
    })
    .map((source, index) => ({ ...source, n: index + 1 }));
  return { sources: available, clearance: activeUser.clearance };
}

export function sameAnalyticsSourceSet(
  expected: readonly AnalyticsSource[],
  actual: readonly AnalyticsSource[],
): boolean {
  if (expected.length !== actual.length) return false;
  // The generated [n] is bound to its exact parent/fragment mapping, not just
  // membership of the same chunk IDs in a differently ordered set.
  return expected.every((source, index) => {
    const candidate = actual[index];
    if (!candidate) return false;
    return (
      source.n === candidate.n &&
      source.chunkId === candidate.chunkId &&
      source.sourceKind === candidate.sourceKind &&
      source.documentId === candidate.documentId &&
      source.briefId === candidate.briefId &&
      source.text === candidate.text &&
      source.charStart === candidate.charStart &&
      source.charEnd === candidate.charEnd
    );
  });
}
