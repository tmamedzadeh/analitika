import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { osintRunIdSchema, osintSearchSchema } from "./osint";
import { az } from "./i18n/az";
import { getCurrentUser } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  osintCache,
  osintPageCache,
  osintRuns,
  osintSearchCache,
  osintQueryCache,
  osintSources,
  appUsers,
} from "@/server/db/schema";
import { osintRunRequested, osintSummaryRetryRequested } from "@/server/inngest/events";
import { inngest } from "@/server/inngest/client";
import { createOsintCacheKey } from "@/server/osint/urls";
import { getAppConfig } from "@/server/config";
import { findPinnedOsintRun, shouldServePinnedCache } from "@/server/osint/cache";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";
import { markStaleOsintRuns } from "@/server/osint/stale-runs";
import { canAccessOsintRun, osintRunHistoryFilter } from "@/server/osint/access";
import type { StoredStructuredReport } from "@/server/osint/reports";
import {
  isStructuredReportAzerbaijani,
  reportSummaryText,
  storedStructuredReportSchema,
} from "@/server/osint/reports";
import { osintDiagnosticsFor } from "@/server/osint/diagnostics";
import { sourceSummaryState, summaryRetryNeeded } from "@/server/osint/source-summary-state";
import { osintStage, type OsintStage } from "@/lib/osint-stage";
import { plainTextFragment } from "@/lib/osint-text";

type OsintProgress = {
  percent: number;
  completedLanguages: number;
  totalLanguages: number;
  sourcesFound: number;
  sourcesProcessed: number;
  failureClass?: "llm" | "limit" | "search" | "page";
  partial?: boolean;
  notice?: string;
  fallbackProvider?: boolean;
  stage?: OsintStage;
};
function serializeProgress(
  value: unknown,
  context: { status: string; step: string },
): OsintProgress {
  const p = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const failures = Array.isArray(p["failedSteps"])
    ? p["failedSteps"].filter((item): item is string => typeof item === "string")
    : [];
  const fetchCounts =
    p["fetchStatusCounts"] && typeof p["fetchStatusCounts"] === "object"
      ? (p["fetchStatusCounts"] as Record<string, unknown>)
      : {};
  const pageFailure = [
    "robots_denied",
    "dns_or_network_error",
    "http_error",
    "non_html",
    "timeout",
    "invalid_url",
  ].some((status) => Number(fetchCounts[status] ?? 0) > 0);
  const failureClass = failures.some((failure) =>
    /limit|rate_limit|429|search_budget/i.test(failure),
  )
    ? "limit"
    : failures.some((failure) => /searching|search/i.test(failure))
      ? "search"
      : pageFailure
        ? "page"
        : failures.length
          ? "llm"
          : undefined;
  const sourcesFound = typeof p["sourcesFound"] === "number" ? p["sourcesFound"] : 0;
  const stage = osintStage({
    status: context.status,
    step: context.step,
    failedSteps: failures,
    sourcesFound,
  });
  return {
    percent: typeof p["percent"] === "number" ? p["percent"] : 0,
    completedLanguages: typeof p["completedLanguages"] === "number" ? p["completedLanguages"] : 0,
    totalLanguages: typeof p["totalLanguages"] === "number" ? p["totalLanguages"] : 0,
    sourcesFound,
    sourcesProcessed: typeof p["sourcesProcessed"] === "number" ? p["sourcesProcessed"] : 0,
    ...(failureClass ? { failureClass } : {}),
    ...(typeof p["partial"] === "boolean" ? { partial: p["partial"] } : {}),
    ...(typeof p["notice"] === "string" ? { notice: p["notice"] } : {}),
    ...(typeof p["fallbackProvider"] === "boolean"
      ? { fallbackProvider: p["fallbackProvider"] }
      : {}),
    ...(stage ? { stage } : {}),
  };
}

function safeStructuredReport(value: unknown): StoredStructuredReport | null {
  const parsed = storedStructuredReportSchema.safeParse(value);
  return parsed.success && isStructuredReportAzerbaijani(parsed.data) ? parsed.data : null;
}

export const startOsintRun = createServerFn({ method: "POST" })
  .validator(osintSearchSchema)
  .handler(async ({ data }) => {
    const user = getCurrentUser();
    if (!(await consumeIpRateLimit("osint-start", getRequest(), 6, 60 * 60_000))) {
      throw new Error(az.analytics.rateLimited);
    }
    const languages = [...new Set(data.languages)],
      config = getAppConfig();
    const cacheKey = createOsintCacheKey(
      data.query,
      languages,
      data.period,
      (config.searchProvider === "exa" ? "exa+tavily:v3" : "gemini_grounding:v3") +
        ":" +
        config.analyticsModel +
        ":" +
        (config.lightModel ?? "no-light-fallback") +
        ":" +
        config.embeddingModel,
    );
    const db = getDb(),
      now = new Date();
    await db.delete(osintCache).where(lte(osintCache.expiresAt, now));
    await db.delete(osintSearchCache).where(lte(osintSearchCache.expiresAt, now));
    await db.delete(osintQueryCache).where(lte(osintQueryCache.expiresAt, now));
    await db.delete(osintPageCache).where(lte(osintPageCache.expiresAt, now));
    const [active] = await db
      .select({ id: osintRuns.id })
      .from(osintRuns)
      .where(
        and(
          eq(osintRuns.cacheKey, cacheKey),
          eq(osintRuns.createdBy, user.id),
          inArray(osintRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active) return { runId: active.id, cacheHit: false, pinned: false };
    if (!data.refresh) {
      const pinned = await findPinnedOsintRun(cacheKey);
      if (
        pinned &&
        shouldServePinnedCache({
          pinned: pinned.pinned,
          done: pinned.status === "done",
          refresh: data.refresh,
        })
      ) {
        return { runId: pinned.id, cacheHit: true, pinned: true };
      }
      const [cached] = await db
        .select({ id: osintRuns.id, createdBy: osintRuns.createdBy })
        .from(osintCache)
        .innerJoin(osintRuns, eq(osintCache.runId, osintRuns.id))
        .where(
          and(
            eq(osintCache.cacheKey, cacheKey),
            gt(osintCache.expiresAt, now),
            eq(osintRuns.status, "done"),
          ),
        )
        .limit(1);
      if (cached) {
        if (cached.createdBy === user.id)
          return { runId: cached.id, cacheHit: true, pinned: false };
        const [sourceRun] = await db
          .select()
          .from(osintRuns)
          .where(eq(osintRuns.id, cached.id))
          .limit(1);
        if (!sourceRun) throw new Error(az.osint.failed);
        const cloneId = crypto.randomUUID();
        const cachedSources = await db
          .select()
          .from(osintSources)
          .where(eq(osintSources.runId, sourceRun.id))
          .orderBy(osintSources.n);
        await db.transaction(async (transaction) => {
          await transaction.insert(osintRuns).values({
            id: cloneId,
            query: sourceRun.query,
            languages: sourceRun.languages,
            period: sourceRun.period,
            status: sourceRun.status,
            step: sourceRun.step,
            progress: sourceRun.progress,
            summary: sourceRun.summary,
            structuredReport: sourceRun.structuredReport,
            cacheKey: sourceRun.cacheKey,
            cacheBypass: false,
            createdBy: user.id,
            clonedFromRunId: sourceRun.id,
            pinned: false,
            heartbeatAt: sourceRun.heartbeatAt,
            createdAt: now,
            finishedAt: sourceRun.finishedAt,
          });
          if (cachedSources.length) {
            await transaction.insert(osintSources).values(
              cachedSources.map((source) => ({
                runId: cloneId,
                n: source.n,
                title: source.title,
                url: source.url,
                domain: source.domain,
                language: source.language,
                originalLanguage: source.originalLanguage,
                publishedAt: source.publishedAt,
                sourceType: source.sourceType,
                summary: source.summary,
                structuredSummary: source.structuredSummary,
                providers: source.providers,
                providerRank: source.providerRank,
                affiliation: source.affiliation,
                snippet: source.snippet,
                fetched: source.fetched,
                fetchStatus: source.fetchStatus,
              })),
            );
          }
        });
        return { runId: cloneId, cacheHit: true, pinned: false };
      }
    }
    const [inserted] = await db
      .insert(osintRuns)
      .values({
        id: crypto.randomUUID(),
        createdBy: user.id,
        query: data.query,
        languages,
        period: data.period,
        cacheKey,
        cacheBypass: data.refresh,
        status: "queued",
        step: "queued",
        heartbeatAt: now,
        progress: {
          percent: 0,
          completedLanguages: 0,
          totalLanguages: languages.length,
          sourcesFound: 0,
          sourcesProcessed: 0,
          fetchStatusCounts: {},
          failedSteps: [],
        },
      })
      .onConflictDoNothing()
      .returning({ id: osintRuns.id });
    if (!inserted) {
      const [existing] = await db
        .select({ id: osintRuns.id })
        .from(osintRuns)
        .where(
          and(
            eq(osintRuns.cacheKey, cacheKey),
            eq(osintRuns.createdBy, user.id),
            inArray(osintRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (!existing) throw new Error(az.osint.failed);
      return { runId: existing.id, cacheHit: false, pinned: false };
    }
    const runId = inserted.id;
    try {
      await inngest.send(osintRunRequested.create({ runId }));
    } catch {
      await db
        .update(osintRuns)
        .set({ status: "failed", step: "failed", error: az.osint.failed, finishedAt: new Date() })
        .where(eq(osintRuns.id, runId));
      throw new Error(az.osint.failed);
    }
    return { runId, cacheHit: false, pinned: false };
  });

export const listOsintRuns = createServerFn({ method: "GET" }).handler(async () => {
  const user = getCurrentUser();
  await markStaleOsintRuns();
  const rows = await getDb()
    .select({
      id: osintRuns.id,
      query: osintRuns.query,
      languages: osintRuns.languages,
      period: osintRuns.period,
      status: osintRuns.status,
      step: osintRuns.step,
      progress: osintRuns.progress,
      error: osintRuns.error,
      pinned: osintRuns.pinned,
      createdAt: osintRuns.createdAt,
      createdBy: osintRuns.createdBy,
      author: appUsers.username,
    })
    .from(osintRuns)
    .innerJoin(appUsers, eq(osintRuns.createdBy, appUsers.id))
    .where(osintRunHistoryFilter(user))
    .orderBy(desc(osintRuns.createdAt))
    .limit(30);
  return rows.map((row) => ({
    ...row,
    progress: serializeProgress(row.progress, { status: row.status, step: row.step }),
    createdAt: row.createdAt.toISOString(),
  }));
});
export const getOsintRun = createServerFn({ method: "GET" })
  .validator(osintRunIdSchema)
  .handler(async ({ data }) => {
    const user = getCurrentUser();
    await markStaleOsintRuns();
    const db = getDb(),
      [run] = await db.select().from(osintRuns).where(eq(osintRuns.id, data.runId)).limit(1);
    if (!run) return null;
    if (!canAccessOsintRun(user, run)) return null;
    const sources = await db
      .select()
      .from(osintSources)
      .where(eq(osintSources.runId, data.runId))
      .orderBy(osintSources.n);
    const structuredReport = safeStructuredReport(run.structuredReport);
    const states = sources.map((source) => ({ source, state: sourceSummaryState(source) }));
    const [author] = await db
      .select({ username: appUsers.username })
      .from(appUsers)
      .where(eq(appUsers.id, run.createdBy))
      .limit(1);
    return {
      ...run,
      author: author?.username ?? "",
      structuredReport,
      summary: structuredReport ? reportSummaryText(structuredReport) : null,
      progress: serializeProgress(run.progress, { status: run.status, step: run.step }),
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      summaryRetryAvailable:
        (run.status === "partial" || run.status === "done") &&
        summaryRetryNeeded({ sources, hasReport: Boolean(structuredReport) }),
      diagnostics: osintDiagnosticsFor(user, {
        status: run.status,
        step: run.step,
        progress: run.progress,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        sources: states.map(({ source, state }) => ({
          hasSummary: Boolean(state.summary),
          fetchStatus: source.fetchStatus,
          summaryStatus: state.status,
        })),
      }),
      sources: states.map(({ source, state }) => ({
        ...source,
        originalTitle: source.title,
        title: state.summary?.title ?? source.domain,
        summary: state.summary?.summary ?? null,
        structuredSummary: state.summary,
        summaryStatus: state.status,
        relevance: state.summary?.relevance ?? null,
        snippet: state.summary ? "" : plainTextFragment(source.snippet, 300),
        publishedAt: source.publishedAt?.toISOString() ?? null,
      })),
    };
  });

export const retryOsintSummary = createServerFn({ method: "POST" })
  .validator(osintRunIdSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const user = getCurrentUser();
    const [run] = await db
      .select({
        id: osintRuns.id,
        createdBy: osintRuns.createdBy,
        pinned: osintRuns.pinned,
        status: osintRuns.status,
        step: osintRuns.step,
        progress: osintRuns.progress,
        structuredReport: osintRuns.structuredReport,
      })
      .from(osintRuns)
      .where(eq(osintRuns.id, data.runId))
      .limit(1);
    if (!run || !canAccessOsintRun(user, run)) {
      throw new Error(az.osint.loadFailed);
    }
    if (run.status === "running" && run.step === "summary_retrying") return { accepted: true };
    if (!(["partial", "done"] as string[]).includes(run.status)) {
      throw new Error(az.osint.loadFailed);
    }
    const sources = await db
      .select({
        n: osintSources.n,
        structuredSummary: osintSources.structuredSummary,
        snippet: osintSources.snippet,
      })
      .from(osintSources)
      .where(eq(osintSources.runId, run.id))
      .orderBy(osintSources.n);
    if (
      !summaryRetryNeeded({
        sources,
        hasReport: Boolean(safeStructuredReport(run.structuredReport)),
      })
    ) {
      throw new Error(az.osint.loadFailed);
    }
    const progress =
      run.progress && typeof run.progress === "object"
        ? (run.progress as Record<string, unknown>)
        : {};
    const [claimed] = await db
      .update(osintRuns)
      .set({
        status: "running",
        step: "summary_retrying",
        progress: { ...progress, percent: Math.min(Number(progress["percent"] ?? 90), 99) },
        heartbeatAt: new Date(),
        error: null,
      })
      .where(and(eq(osintRuns.id, run.id), inArray(osintRuns.status, ["partial", "done"])))
      .returning({ id: osintRuns.id });
    if (!claimed) return { accepted: true };
    try {
      await inngest.send(osintSummaryRetryRequested.create({ runId: run.id }));
    } catch {
      await db
        .update(osintRuns)
        .set({ status: "partial", step: "partial", heartbeatAt: new Date() })
        .where(and(eq(osintRuns.id, run.id), eq(osintRuns.step, "summary_retrying")));
      throw new Error(az.osint.failed);
    }
    return { accepted: true };
  });
