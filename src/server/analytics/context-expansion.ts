import { and, asc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import type { AnalyticsSource } from "@/lib/analytics";
import { AuthorizationError, type SessionUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { chunks } from "@/server/db/schema";
import {
  assertAnalyticsQuestionAccess,
  readLockedAnalyticsSources,
  sameAnalyticsSourceSet,
} from "./source-access";
import { contextChunkProjection, matchesPrimary, type AnalyticsContext } from "./context-identity";
import {
  additionalContextPayload,
  CONTEXT_ANCHOR_LIMIT,
  selectAuxiliaryContext,
  textBytes,
} from "./context-selection";
import { withAnalyticsAbort } from "./abort";

type SkipReason =
  | "disabled"
  | "no_sources"
  | "no_useful_neighbors"
  | "model_mismatch"
  | "sql_error"
  | "access_changed"
  | "expanded";
/** Bounded, batched reads under the same parent locks as source revalidation. */
export async function prepareAnalyticsContext(
  sources: readonly AnalyticsSource[],
  user: Pick<SessionUser, "id" | "clearance">,
  options: { enabled: boolean; embeddingModel: string; signal: AbortSignal },
): Promise<AnalyticsContext | undefined> {
  let sqlStarted: number | undefined;
  let reason: SkipReason = options.enabled ? "no_sources" : "disabled";
  let context: AnalyticsContext | undefined;
  let sqlMs = 0;
  try {
    options.signal.throwIfAborted();
    if (!options.enabled || !sources.length) return undefined;
    if (
      !sources
        .slice(0, CONTEXT_ANCHOR_LIMIT)
        .some(
          (source) => !source.isTable && source.text.length >= 800 && source.sectionTitle.trim(),
        )
    ) {
      reason = "no_useful_neighbors";
      return undefined;
    }
    sqlStarted = performance.now();
    context = await withAnalyticsAbort(
      () =>
        getDb().transaction(async (transaction) => {
          // Transaction-local limits apply only to optional preparation, never to
          // generation, baseline queries or the existing overall deadline.
          await transaction.execute(
            sql`select set_config('statement_timeout', '250ms', true), set_config('lock_timeout', '100ms', true)`,
          );
          options.signal.throwIfAborted();
          const access = await readLockedAnalyticsSources(transaction, sources, user.id);
          assertAnalyticsQuestionAccess(user, access.clearance);
          if (!sameAnalyticsSourceSet(sources, access.sources)) throw new AuthorizationError();
          options.signal.throwIfAborted();
          const primary = await transaction
            .select(contextChunkProjection)
            .from(chunks)
            .where(
              inArray(
                chunks.id,
                sources.map((source) => source.chunkId),
              ),
            )
            .for("share");
          if (sources.some((source) => !primary.some((chunk) => matchesPrimary(source, chunk))))
            throw new AuthorizationError();
          if (primary.some((chunk) => chunk.embeddingModel !== options.embeddingModel)) {
            reason = "model_mismatch";
            return undefined;
          }
          const byId = new Map(primary.map((chunk) => [chunk.id, chunk]));
          const anchors = sources.slice(0, CONTEXT_ANCHOR_LIMIT).flatMap((source) => {
            const chunk = byId.get(source.chunkId);
            return chunk && !chunk.isTable && chunk.text.length >= 800 && chunk.sectionTitle.trim()
              ? [chunk]
              : [];
          });
          reason = "no_useful_neighbors";
          if (!anchors.length) return undefined;
          options.signal.throwIfAborted();
          const neighbors = await transaction
            .select(contextChunkProjection)
            .from(chunks)
            .where(
              and(
                notInArray(
                  chunks.id,
                  sources.map((source) => source.chunkId),
                ),
                or(
                  ...anchors.map((anchor) =>
                    and(
                      anchor.documentId
                        ? eq(chunks.documentId, anchor.documentId)
                        : eq(chunks.briefId, anchor.briefId!),
                      inArray(
                        chunks.ord,
                        [anchor.ord - 1, anchor.ord + 1].filter((ord) => ord >= 0),
                      ),
                      eq(chunks.embeddingModel, anchor.embeddingModel),
                      eq(chunks.sectionTitle, anchor.sectionTitle),
                      eq(chunks.isTable, false),
                    ),
                  ),
                ),
              ),
            )
            .orderBy(asc(chunks.id))
            .limit(CONTEXT_ANCHOR_LIMIT * 2)
            .for("share");
          options.signal.throwIfAborted();
          const auxiliary = selectAuxiliaryContext(sources, primary, neighbors);
          if (!auxiliary.length) return undefined;
          reason = "expanded";
          return { primary, auxiliary };
        }),
      options.signal,
    );
    return context;
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (error instanceof AuthorizationError) {
      reason = "access_changed";
      throw error;
    }
    // The transaction rolls back first. The normal dispatch guard still rechecks baseline access.
    reason = "sql_error";
    return undefined;
  } finally {
    if (sqlStarted !== undefined) sqlMs = Math.max(0, performance.now() - sqlStarted);
    const base = sources.map((source) => source.text).join("");
    const payload = context ? additionalContextPayload(sources, context.auxiliary) : "";
    console.info(
      "[analytics-context] " +
        JSON.stringify({
          enabled: options.enabled,
          primaryChunks: sources.length,
          auxiliaryChunks: context?.auxiliary.length ?? 0,
          baseChars: base.length,
          baseBytes: textBytes(base),
          auxiliaryChars: payload.length,
          auxiliaryBytes: textBytes(payload),
          increasePercent: base.length ? +((payload.length / base.length) * 100).toFixed(2) : 0,
          sqlMs: +sqlMs.toFixed(2),
          reason: options.signal.aborted ? "aborted" : reason,
        }),
    );
  }
}
