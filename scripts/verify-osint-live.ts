import { and, eq } from "drizzle-orm";

import { OSINT_LANGUAGES, type OsintPeriod } from "../src/lib/osint";
import { closeDb, getDb } from "../src/server/db";
import { appUsers, osintRuns, osintSources } from "../src/server/db/schema";
import { getAppConfig } from "../src/server/config";
import { createOsintCacheKey } from "../src/server/osint/urls";
import { runOsintJob } from "../src/server/jobs/run-osint";
import { findPinnedOsintRun, shouldServePinnedCache } from "../src/server/osint/cache";

const period: OsintPeriod = "30d";
const cases = [
  {
    label: "Regional negotiations",
    query: "Aktual regional danışıqlar və Qafqazda iqtisadi əməkdaşlıq barədə son məlumatlar",
  },
  {
    label: "Transport corridors",
    query: "Qafqazda nəqliyyat dəhlizlərinin inkişafı və yük daşımalarına təsiri",
  },
] as const;
const selectedCases: readonly (typeof cases)[number][] = process.argv.includes("--transport-only")
  ? [cases[1]]
  : cases;

function onlyHandledUrlRejections(steps: string): boolean {
  return (
    steps === "none" ||
    steps
      .split(", ")
      .filter(Boolean)
      .every((step) => /^url_validation:[a-z]{2}:invalid_url$/.test(step))
  );
}

type RunResult = {
  label: string;
  status: string;
  languages: Record<(typeof OSINT_LANGUAGES)[number], number>;
  exaText: number;
  fetchedFull: number;
  snippets: number;
  fetchErrors: string;
  seconds: number;
  failedSteps: string;
  cacheHit: boolean;
};

async function runCase(item: (typeof cases)[number]): Promise<RunResult> {
  const db = getDb();
  const [runOwner] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.role, "admin"))
    .limit(1);
  if (!runOwner) throw new Error("An administrator account is required for this live check.");
  const config = getAppConfig();
  const languages = [...OSINT_LANGUAGES];
  const cacheKey = createOsintCacheKey(
    item.query,
    languages,
    period,
    `${config.searchProvider}:${config.analyticsModel}:${config.lightModel}`,
  );
  await db
    .update(osintRuns)
    .set({ pinned: false })
    .where(and(eq(osintRuns.cacheKey, cacheKey), eq(osintRuns.pinned, true)));
  const runId = crypto.randomUUID();
  const started = Date.now();
  await db.insert(osintRuns).values({
    id: runId,
    query: item.query,
    createdBy: runOwner.id,
    languages,
    period,
    cacheKey,
    status: "queued",
    step: "queued",
    progress: {},
  });

  await runOsintJob(runId);
  const [run] = await db.select().from(osintRuns).where(eq(osintRuns.id, runId)).limit(1);
  if (!run) throw new Error("OSINT run row disappeared.");
  const sourceRows = await db
    .select({ language: osintSources.language, fetchStatus: osintSources.fetchStatus })
    .from(osintSources)
    .where(eq(osintSources.runId, runId));
  const progress = run.progress as Record<string, unknown>;
  const fetchCounts = (progress["fetchStatusCounts"] ?? {}) as Record<string, number>;
  const languagesByCount = Object.fromEntries(
    OSINT_LANGUAGES.map((language) => [language, 0]),
  ) as RunResult["languages"];
  for (const row of sourceRows) {
    if (row.language in languagesByCount) {
      languagesByCount[row.language as keyof typeof languagesByCount] += 1;
    }
  }

  const failedSteps = Array.isArray(progress["failedSteps"])
    ? (progress["failedSteps"] as unknown[])
        .filter((step): step is string => typeof step === "string")
        .join(", ") || "none"
    : "none";
  const uniqueLanguages = new Set(sourceRows.map((source) => source.language)).size;
  const durationSeconds = (Date.now() - started) / 1000;
  const acceptable =
    run.status === "done" &&
    sourceRows.length > 0 &&
    uniqueLanguages >= 4 &&
    durationSeconds <= 60 &&
    onlyHandledUrlRejections(failedSteps);
  if (acceptable) {
    await db.update(osintRuns).set({ pinned: true }).where(eq(osintRuns.id, runId));
  }
  const pinnedRun = acceptable ? await findPinnedOsintRun(cacheKey) : null;
  const cacheHit = Boolean(
    pinnedRun &&
    pinnedRun.id === runId &&
    shouldServePinnedCache({
      pinned: pinnedRun.pinned,
      done: pinnedRun.status === "done",
      refresh: false,
    }),
  );

  const fetchErrors =
    Object.entries(fetchCounts)
      .filter(
        ([status, count]) =>
          count > 0 && !["provider_text", "fetched_full", "snippet_fallback"].includes(status),
      )
      .map(([status, count]) => `${status}:${count}`)
      .join(", ") || "none";
  return {
    label: item.label,
    status: run.status,
    languages: languagesByCount,
    exaText: fetchCounts["provider_text"] ?? 0,
    fetchedFull: fetchCounts["fetched_full"] ?? 0,
    snippets: fetchCounts["snippet_fallback"] ?? 0,
    fetchErrors,
    seconds: Number(durationSeconds.toFixed(1)),
    failedSteps,
    cacheHit,
  };
}

const rows: RunResult[] = [];
try {
  for (const item of selectedCases) {
    const row = await runCase(item);
    rows.push(row);
    const hasUnhandledFailure = !onlyHandledUrlRejections(row.failedSteps);
    if (hasUnhandledFailure || row.status !== "done") {
      console.table(
        rows.map((result) => ({
          query: result.label,
          status: result.status,
          fa: result.languages.fa,
          hy: result.languages.hy,
          ru: result.languages.ru,
          zh: result.languages.zh,
          en: result.languages.en,
          fr: result.languages.fr,
          "Exa text": result.exaText,
          "fetched full": result.fetchedFull,
          snippets: result.snippets,
          errors: result.fetchErrors,
          seconds: result.seconds,
          failedSteps: result.failedSteps,
          cacheHit: result.cacheHit,
        })),
      );
      console.error("OSINT live check stopped because a run did not complete.");
      process.exitCode = 1;
      break;
    }
  }
  if (rows.length === selectedCases.length) {
    console.table(
      rows.map((result) => ({
        query: result.label,
        status: result.status,
        fa: result.languages.fa,
        hy: result.languages.hy,
        ru: result.languages.ru,
        zh: result.languages.zh,
        en: result.languages.en,
        fr: result.languages.fr,
        "Exa text": result.exaText,
        "fetched full": result.fetchedFull,
        snippets: result.snippets,
        errors: result.fetchErrors,
        seconds: result.seconds,
        failedSteps: result.failedSteps,
        cacheHit: result.cacheHit,
      })),
    );
    console.log(
      "Live check completion status and source counts are shown; query text is not logged.",
    );
  }
} catch {
  console.error(
    "OSINT live check failed. Review provider quota/configuration; no query or key was logged.",
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
