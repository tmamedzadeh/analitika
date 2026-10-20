import { eq } from "drizzle-orm";

import { processDocumentJob } from "../jobs/process-document";
import { runOsintJob } from "../jobs/run-osint";
import { retryOsintSummaryJob } from "../jobs/retry-osint-summary";
import { pruneAnalyticsHistory } from "../analytics/history";
import { indexBriefJob } from "../jobs/index-brief";
import { cleanupOrphanedStorageUploads } from "../jobs/cleanup-storage";
import { markStaleOsintRuns } from "../osint/stale-runs";
import { getDb } from "../db";
import { dailyBriefs } from "../db/schema";
import { inngest } from "./client";
import {
  briefIndexingRequested,
  documentIndexingRequested,
  osintRunRequested,
  osintSummaryRetryRequested,
} from "./events";

const processDocument = inngest.createFunction(
  {
    id: "process-document",
    retries: 1,
    triggers: [documentIndexingRequested],
    idempotency: "event.data.documentId",
    concurrency: { limit: 3 },
  },
  async ({ event }) => processDocumentJob(event.data.documentId),
);

const runOsint = inngest.createFunction(
  {
    id: "run-osint",
    triggers: [osintRunRequested],
    idempotency: "event.data.runId",
    concurrency: { limit: 2 },
  },
  async ({ event }) => runOsintJob(event.data.runId),
);

const retryOsintSummary = inngest.createFunction(
  {
    id: "retry-osint-summary",
    triggers: [osintSummaryRetryRequested],
    idempotency: "event.data.runId",
    concurrency: { limit: 3 },
  },
  async ({ event }) => retryOsintSummaryJob(event.data.runId),
);

const indexBrief = inngest.createFunction(
  {
    id: "index-brief",
    retries: 1,
    triggers: [briefIndexingRequested],
    idempotency: "event.data.briefId",
    concurrency: { limit: 3 },
  },
  async ({ event }) => indexBriefJob(event.data.briefId),
);

const requeuePendingBriefs = inngest.createFunction(
  { id: "requeue-pending-briefs", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const queued = await getDb()
      .select({ briefId: dailyBriefs.id })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.indexStatus, "queued"))
      .limit(100);
    await Promise.all(
      queued.map(({ briefId }) => inngest.send(briefIndexingRequested.create({ briefId }))),
    );
    return { queued: queued.length };
  },
);

const cleanupStorage = inngest.createFunction(
  { id: "cleanup-orphaned-uploads", triggers: [{ cron: "0 2 * * *" }] },
  async () => cleanupOrphanedStorageUploads(),
);

const cleanupAnalyticsHistory = inngest.createFunction(
  { id: "cleanup-analytics-history", triggers: [{ cron: "0 2 * * *" }] },
  async () => ({ deleted: await pruneAnalyticsHistory() }),
);

const closeStaleOsintRuns = inngest.createFunction(
  { id: "close-stale-osint-runs", triggers: [{ cron: "*/5 * * * *" }] },
  async () => ({ closed: await markStaleOsintRuns() }),
);

export const functions = [
  processDocument,
  runOsint,
  retryOsintSummary,
  indexBrief,
  requeuePendingBriefs,
  cleanupStorage,
  cleanupAnalyticsHistory,
  closeStaleOsintRuns,
];
