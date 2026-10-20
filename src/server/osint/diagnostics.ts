import type { SessionUser } from "../auth";
import { SUMMARY_STATUSES, type SummaryOutputFailure, type SummaryStatus } from "./reports";

export const OSINT_ERROR_CLASSES = [
  "rate_limit",
  "timeout",
  "invalid_json",
  "language",
  "schema",
  "cache_unavailable",
  "other",
] as const;
export type OsintErrorClass = (typeof OSINT_ERROR_CLASSES)[number];

export type OsintDiagnosticsProgress = {
  stageMs: Record<string, number>;
  searchQueries: number;
  providers: string[];
  sourcesSelected: number;
  llmAttempts: { summary: number; report: number };
  cacheErrors: number;
};

export type OsintDiagnostics = {
  status: string;
  step: string;
  durationMs: number | null;
  stageMs: Record<string, number>;
  llmAttempts: { summary: number; report: number };
  errorClasses: Partial<Record<OsintErrorClass, number>>;
  providers: string[];
  searchQueries: number;
  sourcesFound: number;
  sourcesSelected: number;
  summaries: { present: number; missing: Partial<Record<SummaryStatus, number>> };
  fetchStatus: Record<string, number>;
  expansionFallbackLanguages: string[];
};

const CATEGORY_CLASS: Record<string, OsintErrorClass> = {
  rate_limit: "rate_limit",
  search_budget: "rate_limit",
  timeout: "timeout",
  invalid_json: "invalid_json",
  language: "language",
  schema: "schema",
  cache_unavailable: "cache_unavailable",
  other: "other",
};

const LABEL_CLASS: Record<string, OsintErrorClass> = {
  "report:invalid_source_numbers": "schema",
  "report:no_validated_findings": "schema",
};

const REASON_CLASS: Record<SummaryOutputFailure, OsintErrorClass> = {
  generation_failed: "other",
  invalid_json: "invalid_json",
  schema: "schema",
  language: "language",
  source_number: "schema",
  missing: "schema",
};

export function errorClassForFailure(label: string): OsintErrorClass | null {
  if (label === "summarizing:incomplete_sources") return null;
  // Own-property lookups only: stored labels are untrusted JSON, and names such as
  // "constructor" or "__proto__" must not resolve to inherited Object members.
  const mapped = Object.hasOwn(LABEL_CLASS, label) ? LABEL_CLASS[label] : undefined;
  if (mapped) return mapped;
  const category = label.split(":").pop() ?? "";
  return Object.hasOwn(CATEGORY_CLASS, category) ? (CATEGORY_CLASS[category] ?? "other") : "other";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function stringList(value: unknown, pattern: RegExp): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && pattern.test(item))
    : [];
}

function numberMap(value: unknown, allowed?: readonly string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record(value))) {
    if (allowed && !allowed.includes(key)) continue;
    if (!/^[a-z_]{1,40}$/.test(key)) continue;
    const number = count(raw);
    if (number > 0 || !allowed) output[key] = number;
  }
  return output;
}

export function mergeRetryDiagnostics(
  previous: unknown,
  added: { elapsedMs: number; summaryCalls: number; reportAttempts: number },
): OsintDiagnosticsProgress {
  const old = record(record(previous)["diagnostics"]);
  const llm = record(old["llmAttempts"]);
  const stageMs = numberMap(old["stageMs"]);
  stageMs["summary_retrying"] =
    (stageMs["summary_retrying"] ?? 0) + Math.max(0, Math.round(added.elapsedMs));
  return {
    stageMs,
    searchQueries: count(old["searchQueries"]),
    providers: stringList(old["providers"], /^[a-z_]{2,30}$/),
    sourcesSelected: count(old["sourcesSelected"]),
    llmAttempts: {
      summary: count(llm["summary"]) + added.summaryCalls,
      report: count(llm["report"]) + added.reportAttempts,
    },
    cacheErrors: count(old["cacheErrors"]),
  };
}

export function buildOsintDiagnostics(input: {
  status: string;
  step: string;
  progress: unknown;
  createdAt: Date;
  finishedAt: Date | null;
  sources: readonly {
    hasSummary: boolean;
    fetchStatus: string;
    summaryStatus: SummaryStatus | null;
  }[];
}): OsintDiagnostics {
  const progress = record(input.progress);
  const diagnostics = record(progress["diagnostics"]);
  const failedSteps = Array.isArray(progress["failedSteps"])
    ? progress["failedSteps"].filter((item): item is string => typeof item === "string")
    : [];
  const errorClasses: Partial<Record<OsintErrorClass, number>> = {};
  const addClass = (item: OsintErrorClass, amount = 1) => {
    errorClasses[item] = (errorClasses[item] ?? 0) + amount;
  };
  for (const label of failedSteps) {
    const item = errorClassForFailure(label);
    if (item) addClass(item);
  }
  const cacheErrors = count(diagnostics["cacheErrors"]);
  if (cacheErrors) addClass("cache_unavailable", cacheErrors);
  const reasons = record(progress["summaryFailureReasons"]);
  for (const reason of Object.keys(REASON_CLASS) as SummaryOutputFailure[]) {
    const amount = count(reasons[reason]);
    if (amount) addClass(REASON_CLASS[reason], amount);
  }

  const missing: Partial<Record<SummaryStatus, number>> = {};
  const fetchStatus: Record<string, number> = {};
  let present = 0;
  for (const source of input.sources) {
    if (source.hasSummary) present += 1;
    else if (source.summaryStatus)
      missing[source.summaryStatus] = (missing[source.summaryStatus] ?? 0) + 1;
    if (/^[a-z_]{1,40}$/.test(source.fetchStatus)) {
      const previous = Object.hasOwn(fetchStatus, source.fetchStatus)
        ? (fetchStatus[source.fetchStatus] ?? 0)
        : 0;
      fetchStatus[source.fetchStatus] = previous + 1;
    }
  }
  const llm = record(diagnostics["llmAttempts"]);
  const providers = stringList(diagnostics["providers"], /^[a-z_]{2,30}$/);
  const fallback = stringList(progress["expansionFallbackLanguages"], /^[a-z]{2}$/);
  return {
    status: input.status,
    step: input.step,
    durationMs: input.finishedAt ? input.finishedAt.getTime() - input.createdAt.getTime() : null,
    stageMs: numberMap(diagnostics["stageMs"]),
    llmAttempts: { summary: count(llm["summary"]), report: count(llm["report"]) },
    errorClasses,
    providers,
    searchQueries: count(diagnostics["searchQueries"]),
    sourcesFound: count(progress["sourcesFound"]),
    sourcesSelected: count(diagnostics["sourcesSelected"]) || input.sources.length,
    summaries: { present, missing },
    fetchStatus,
    expansionFallbackLanguages: fallback,
  };
}

export function osintDiagnosticsFor(
  user: Pick<SessionUser, "role">,
  input: Parameters<typeof buildOsintDiagnostics>[0],
): OsintDiagnostics | null {
  return user.role === "admin" ? buildOsintDiagnostics(input) : null;
}

export { SUMMARY_STATUSES };
