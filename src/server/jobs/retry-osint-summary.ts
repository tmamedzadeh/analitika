import { and, eq } from "drizzle-orm";

import { az } from "@/lib/i18n/az";
import { createGeminiProviders } from "../ai/gemini";
import { getDb } from "../db";
import { osintRuns, osintSources } from "../db/schema";
import { readServerEnv } from "../env";
import { mergeRetryDiagnostics } from "../osint/diagnostics";
import { readCachedPublicPageText } from "../osint/page-cache";
import { synthesizeReport, type SynthesisSource } from "../osint/report-synthesis";
import {
  keepExplicitTimelineDates,
  reportSummaryText,
  type StoredStructuredReport,
  type SummaryOutputFailure,
  type SummaryStatus,
} from "../osint/reports";
import {
  legacySummaryStatus,
  readStoredSummary,
  readStoredSummaryStatus,
  type StoredSourceSummary,
} from "../osint/source-summary-state";
import { skippedSummaryOutcome, summarizeSources } from "../osint/summary-generation";
import { osintFailureCategory } from "./run-osint";

const MAX_RETRY_MS = 120_000;
const SUMMARY_STAGE_FAILURE = /^(summarizing|synthesizing|report:|summary_retry)/;

export function osintSummaryRetryClaimed(input: {
  status: string;
  step: string;
  sourceCount: number;
}): boolean {
  return input.status === "running" && input.step === "summary_retrying" && input.sourceCount > 0;
}

export function buildRetryProgress(
  previous: unknown,
  input: {
    statusCounts: Partial<Record<SummaryStatus, number>>;
    failureReasons: Partial<Record<SummaryOutputFailure, number>>;
    failures: readonly string[];
    notes: readonly string[];
    elapsedMs: number;
    summaryCalls: number;
    reportAttempts: number;
  },
): { progress: Record<string, unknown>; partial: boolean } {
  const base =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
  const previousFailures = Array.isArray(base["failedSteps"])
    ? base["failedSteps"].filter((item): item is string => typeof item === "string")
    : [];
  const failedSteps = [
    ...previousFailures.filter((label) => !SUMMARY_STAGE_FAILURE.test(label)),
    ...input.failures,
  ];
  if (Object.keys(input.statusCounts).length) failedSteps.push("summarizing:incomplete_sources");
  const unique = [...new Set(failedSteps)];
  const partial = unique.length > 0;
  const progress: Record<string, unknown> = {
    ...base,
    failedSteps: unique,
    partial,
    summaryStatusCounts: input.statusCounts,
    summaryFailureReasons: input.failureReasons,
    reportNotes: [...input.notes],
    diagnostics: mergeRetryDiagnostics(previous, {
      elapsedMs: input.elapsedMs,
      summaryCalls: input.summaryCalls,
      reportAttempts: input.reportAttempts,
    }),
    percent: partial ? 99 : 100,
  };
  if (partial) {
    progress["notice"] =
      typeof base["notice"] === "string" ? base["notice"] : az.osint.partialNotice;
  } else if (base["notice"] === az.osint.partialNotice) {
    delete progress["notice"];
  }
  return { progress, partial };
}

export function retryFailureProgress(previous: unknown, label: string): Record<string, unknown> {
  const base =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
  const failedSteps = Array.isArray(base["failedSteps"])
    ? base["failedSteps"].filter((item): item is string => typeof item === "string")
    : [];
  return {
    ...base,
    failedSteps: [...new Set([...failedSteps, label])],
    partial: true,
    percent: 99,
    notice: typeof base["notice"] === "string" ? base["notice"] : az.osint.partialNotice,
  };
}

function failureLabel(name: string, error?: unknown): string {
  return error ? name + ":" + osintFailureCategory(error) : name;
}

export async function retryOsintSummaryJob(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(osintRuns).where(eq(osintRuns.id, runId)).limit(1);
  if (!run) return;
  const rows = await db
    .select()
    .from(osintSources)
    .where(eq(osintSources.runId, runId))
    .orderBy(osintSources.n);
  if (!osintSummaryRetryClaimed({ status: run.status, step: run.step, sourceCount: rows.length }))
    return;

  const startedAt = Date.now();
  const remaining = () => Math.max(0, MAX_RETRY_MS - (Date.now() - startedAt));
  const env = readServerEnv();
  const aborter = new AbortController();
  const overallTimeout = setTimeout(() => aborter.abort(new Error("deadline")), MAX_RETRY_MS);
  const guard = and(eq(osintRuns.id, runId), eq(osintRuns.step, "summary_retrying"));
  try {
    const providers = createGeminiProviders();
    const valid = new Map<number, StoredSourceSummary>();
    const pending: typeof rows = [];
    for (const row of rows) {
      const stored = readStoredSummary(row.structuredSummary, row.n);
      if (stored) valid.set(row.n, stored);
      else pending.push(row);
    }

    const inputs = await Promise.all(
      pending.map(async (row) => ({
        number: row.n,
        title: row.title,
        ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
        text: (await readCachedPublicPageText(row.url))?.trim() || row.snippet,
        fetched: row.fetched,
      })),
    );
    const outcome = !inputs.length
      ? {
          summaries: new Map(),
          statuses: new Map<number, SummaryStatus>(),
          failureReasons: {},
          calls: 0,
        }
      : remaining() > 1_000
        ? await summarizeSources({
            query: run.query,
            sources: inputs,
            light: providers.light,
            thinkingLevel: env.OSINT_THINKING_LEVEL,
            signal: aborter.signal,
            canRetry: () => !aborter.signal.aborted && remaining() > 1_000,
          })
        : skippedSummaryOutcome(inputs);

    const statusCounts: Partial<Record<SummaryStatus, number>> = {};
    for (const row of pending) {
      const summary = outcome.summaries.get(row.n);
      if (summary) {
        valid.set(row.n, { ...summary });
        await db
          .update(osintSources)
          .set({ summary: summary.summary, structuredSummary: summary })
          .where(eq(osintSources.id, row.id));
        continue;
      }
      const status: SummaryStatus =
        outcome.statuses.get(row.n) ??
        readStoredSummaryStatus(row.structuredSummary) ??
        legacySummaryStatus(row.snippet);
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      await db
        .update(osintSources)
        .set({ summary: null, structuredSummary: { summaryStatus: status } })
        .where(eq(osintSources.id, row.id));
    }

    const records: SynthesisSource[] = rows.flatMap((row) => {
      const summary = valid.get(row.n);
      return summary
        ? [
            {
              number: row.n,
              title: summary.title,
              domain: row.domain,
              language: row.language,
              sourceType: row.sourceType,
              publicationDate: summary.publicationDate,
              summary: summary.summary,
              claims: summary.claims,
              entities: summary.entities,
              eventDate: summary.eventDate,
              quote: summary.quote,
              relevance: summary.relevance,
            },
          ]
        : [];
    });

    const failures: string[] = [];
    const notes: string[] = [];
    let reportAttempts = 0;
    let report: StoredStructuredReport | null = null;
    if (records.length && remaining() > 1_000) {
      const synthesis = await synthesizeReport({
        query: run.query,
        sources: records,
        light: providers.light,
        thinkingLevel: env.OSINT_THINKING_LEVEL,
        signal: aborter.signal,
        canRetry: () => !aborter.signal.aborted && remaining() > 1_000,
      });
      reportAttempts = synthesis.attempts;
      notes.push(...synthesis.notes);
      for (const failure of synthesis.failures) {
        failures.push(failureLabel(failure.name, failure.error));
      }
      report = synthesis.report ? keepExplicitTimelineDates(synthesis.report, records) : null;
    } else if (records.length) {
      failures.push(failureLabel("synthesizing", new Error("Step timeout.")));
    } else {
      failures.push(failureLabel("synthesizing", new Error("No summaries available.")));
    }

    const { progress, partial } = buildRetryProgress(run.progress, {
      statusCounts,
      failureReasons: outcome.failureReasons,
      failures,
      notes,
      elapsedMs: Date.now() - startedAt,
      summaryCalls: outcome.calls,
      reportAttempts,
    });
    const keepPrevious = !report;
    await db
      .update(osintRuns)
      .set({
        status: partial || keepPrevious ? "partial" : "done",
        step: partial || keepPrevious ? "partial" : "done",
        progress: keepPrevious ? { ...progress, partial: true, percent: 99 } : progress,
        ...(report ? { summary: reportSummaryText(report), structuredReport: report } : {}),
        error: null,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(guard);
  } catch (error) {
    console.error("[OSINT] retry_summary error=" + osintFailureCategory(error));
    await db
      .update(osintRuns)
      .set({
        status: "partial",
        step: "partial",
        progress: retryFailureProgress(run.progress, failureLabel("summary_retry", error)),
        error: null,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(guard);
  } finally {
    clearTimeout(overallTimeout);
  }
}
