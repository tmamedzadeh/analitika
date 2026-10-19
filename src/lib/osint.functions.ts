import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  OSINT_GEMINI_CALL_BUDGET,
  OSINT_SEARCH_CALL_BUDGET,
  osintRunIdSchema,
  osintSearchSchema,
} from "./osint";
import { az } from "./i18n/az";
import { getDb } from "@/server/db";
import {
  osintCache,
  osintPageCache,
  osintRuns,
  osintSearchCache,
  osintSources,
} from "@/server/db/schema";
import { osintRunRequested } from "@/server/inngest/events";
import { inngest } from "@/server/inngest/client";
import { createOsintCacheKey } from "@/server/osint/urls";
import { getAppConfig } from "@/server/config";
import { findPinnedOsintRun, shouldServePinnedCache } from "@/server/osint/cache";
import { consumeIpRateLimit } from "@/server/analytics/rate-limit";
import { markStaleOsintRuns } from "@/server/osint/stale-runs";
import type { SourceSummary, StructuredReport } from "@/server/osint/reports";

type OsintProgress = {
  percent: number;
  completedLanguages: number;
  totalLanguages: number;
  sourcesFound: number;
  sourcesProcessed: number;
  providerCalls: number;
  providerCallBudget: number;
  searchCalls: number;
  llmCalls: number;
  llmCallBudget: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmUsageReportedCalls: number;
  fetchStatusCounts: Record<string, number>;
  failedSteps: string[];
  currentLanguage?: string;
  partial?: boolean;
  notice?: string;
  fallbackProvider?: boolean;
  fallbackReason?: string;
};
function serializeProgress(value: unknown): OsintProgress {
  const p = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    percent: typeof p["percent"] === "number" ? p["percent"] : 0,
    completedLanguages: typeof p["completedLanguages"] === "number" ? p["completedLanguages"] : 0,
    totalLanguages: typeof p["totalLanguages"] === "number" ? p["totalLanguages"] : 0,
    sourcesFound: typeof p["sourcesFound"] === "number" ? p["sourcesFound"] : 0,
    sourcesProcessed: typeof p["sourcesProcessed"] === "number" ? p["sourcesProcessed"] : 0,
    providerCalls: typeof p["providerCalls"] === "number" ? p["providerCalls"] : 0,
    providerCallBudget:
      typeof p["providerCallBudget"] === "number"
        ? p["providerCallBudget"]
        : OSINT_SEARCH_CALL_BUDGET,
    searchCalls: typeof p["searchCalls"] === "number" ? p["searchCalls"] : 0,
    llmCalls: typeof p["llmCalls"] === "number" ? p["llmCalls"] : 0,
    llmCallBudget: OSINT_GEMINI_CALL_BUDGET,
    llmInputTokens: typeof p["llmInputTokens"] === "number" ? p["llmInputTokens"] : 0,
    llmOutputTokens: typeof p["llmOutputTokens"] === "number" ? p["llmOutputTokens"] : 0,
    llmUsageReportedCalls:
      typeof p["llmUsageReportedCalls"] === "number" ? p["llmUsageReportedCalls"] : 0,
    fetchStatusCounts:
      p["fetchStatusCounts"] && typeof p["fetchStatusCounts"] === "object"
        ? (p["fetchStatusCounts"] as Record<string, number>)
        : {},
    failedSteps: Array.isArray(p["failedSteps"])
      ? p["failedSteps"].filter((x): x is string => typeof x === "string")
      : [],
    ...(typeof p["currentLanguage"] === "string" ? { currentLanguage: p["currentLanguage"] } : {}),
    ...(typeof p["partial"] === "boolean" ? { partial: p["partial"] } : {}),
    ...(typeof p["notice"] === "string" ? { notice: p["notice"] } : {}),
    ...(typeof p["fallbackProvider"] === "boolean"
      ? { fallbackProvider: p["fallbackProvider"] }
      : {}),
    ...(typeof p["fallbackReason"] === "string" ? { fallbackReason: p["fallbackReason"] } : {}),
  };
}

export const startOsintRun = createServerFn({ method: "POST" })
  .validator(osintSearchSchema)
  .handler(async ({ data }) => {
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
        config.lightModel +
        ":" +
        config.embeddingModel,
    );
    const db = getDb(),
      now = new Date();
    await db.delete(osintCache).where(lte(osintCache.expiresAt, now));
    await db.delete(osintSearchCache).where(lte(osintSearchCache.expiresAt, now));
    await db.delete(osintPageCache).where(lte(osintPageCache.expiresAt, now));
    const [active] = await db
      .select({ id: osintRuns.id })
      .from(osintRuns)
      .where(
        and(eq(osintRuns.cacheKey, cacheKey), inArray(osintRuns.status, ["queued", "running"])),
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
        .select({ id: osintRuns.id })
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
      if (cached) return { runId: cached.id, cacheHit: true, pinned: false };
    }
    const [inserted] = await db
      .insert(osintRuns)
      .values({
        id: crypto.randomUUID(),
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
          providerCalls: 0,
          providerCallBudget: OSINT_SEARCH_CALL_BUDGET,
          searchCalls: 0,
          llmCalls: 0,
          llmCallBudget: OSINT_GEMINI_CALL_BUDGET,
          llmInputTokens: 0,
          llmOutputTokens: 0,
          llmUsageReportedCalls: 0,
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
          and(eq(osintRuns.cacheKey, cacheKey), inArray(osintRuns.status, ["queued", "running"])),
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
      summary: osintRuns.summary,
      error: osintRuns.error,
      pinned: osintRuns.pinned,
      createdAt: osintRuns.createdAt,
    })
    .from(osintRuns)
    .orderBy(desc(osintRuns.createdAt))
    .limit(30);
  return rows.map((row) => ({
    ...row,
    progress: serializeProgress(row.progress),
    createdAt: row.createdAt.toISOString(),
  }));
});
export const getOsintRun = createServerFn({ method: "GET" })
  .validator(osintRunIdSchema)
  .handler(async ({ data }) => {
    await markStaleOsintRuns();
    const db = getDb(),
      [run] = await db.select().from(osintRuns).where(eq(osintRuns.id, data.runId)).limit(1);
    if (!run) return null;
    const sources = await db
      .select()
      .from(osintSources)
      .where(eq(osintSources.runId, data.runId))
      .orderBy(osintSources.n);
    return {
      ...run,
      structuredReport: run.structuredReport as StructuredReport | null,
      progress: serializeProgress(run.progress),
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      sources: sources.map((source) => ({
        ...source,
        structuredSummary: source.structuredSummary as SourceSummary | null,
        publishedAt: source.publishedAt?.toISOString() ?? null,
      })),
    };
  });
