import { desc, eq, gt } from "drizzle-orm";

import { OSINT_LANGUAGES } from "../src/lib/osint";
import { closeDb, getDb } from "../src/server/db";
import { osintRuns, osintSources } from "../src/server/db/schema";
import { getAppConfig } from "../src/server/config";
import { createOsintCacheKey } from "../src/server/osint/urls";

const knownCases = [
  {
    label: "Regional negotiations",
    query: "Aktual regional danışıqlar və Qafqazda iqtisadi əməkdaşlıq barədə son məlumatlar",
  },
  {
    label: "Transport corridors",
    query: "Qafqazda nəqliyyat dəhlizlərinin inkişafı və yük daşımalarına təsiri",
  },
] as const;

try {
  const db = getDb();
  const config = getAppConfig();
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const runs = await db
    .select({
      id: osintRuns.id,
      cacheKey: osintRuns.cacheKey,
      status: osintRuns.status,
      step: osintRuns.step,
      progress: osintRuns.progress,
      error: osintRuns.error,
      pinned: osintRuns.pinned,
      createdAt: osintRuns.createdAt,
      finishedAt: osintRuns.finishedAt,
    })
    .from(osintRuns)
    .where(gt(osintRuns.createdAt, since))
    .orderBy(desc(osintRuns.createdAt))
    .limit(2);
  const output = [];
  for (const [index, run] of [...runs].reverse().entries()) {
    const matchingCase = knownCases.find(
      (item) =>
        createOsintCacheKey(
          item.query,
          [...OSINT_LANGUAGES],
          "30d",
          `${config.searchProvider}:${config.analyticsModel}:${config.lightModel}`,
        ) === run.cacheKey,
    );
    const sources = await db
      .select({ language: osintSources.language, fetchStatus: osintSources.fetchStatus })
      .from(osintSources)
      .where(eq(osintSources.runId, run.id));
    const languages = Object.fromEntries(
      OSINT_LANGUAGES.map((language) => [language, 0]),
    ) as Record<(typeof OSINT_LANGUAGES)[number], number>;
    const fetch = new Map<string, number>();
    for (const source of sources) {
      if (source.language in languages) languages[source.language as keyof typeof languages] += 1;
      fetch.set(source.fetchStatus, (fetch.get(source.fetchStatus) ?? 0) + 1);
    }
    const progress = run.progress as Record<string, unknown>;
    const counts = progress["fetchStatusCounts"] as Record<string, number> | undefined;
    const failedSteps = Array.isArray(progress["failedSteps"])
      ? (progress["failedSteps"] as unknown[])
          .filter((step): step is string => typeof step === "string")
          .join(", ") || "none"
      : "none";
    output.push({
      query: matchingCase?.label ?? `recent run ${index + 1}`,
      status: run.status,
      step: run.step,
      fa: languages.fa,
      hy: languages.hy,
      ru: languages.ru,
      zh: languages.zh,
      en: languages.en,
      fr: languages.fr,
      "Exa text": fetch.get("provider_text") ?? 0,
      "fetched full": fetch.get("fetched_full") ?? 0,
      snippets: fetch.get("snippet_fallback") ?? 0,
      fetchErrors:
        [...fetch.entries()]
          .filter(
            ([status]) => !["provider_text", "fetched_full", "snippet_fallback"].includes(status),
          )
          .map(([status, count]) => `${status}:${count}`)
          .join(", ") || "none",
      seconds: run.finishedAt
        ? Number(((run.finishedAt.getTime() - run.createdAt.getTime()) / 1000).toFixed(1))
        : "running",
      failures: failedSteps,
      pinned: run.pinned,
      error: run.error ?? "none",
      recordedFetchCounts: counts ?? {},
    });
  }
  console.table(output);
} catch {
  console.error("Could not read OSINT run metrics; no query text or API detail was printed.");
  process.exitCode = 1;
} finally {
  await closeDb();
}
