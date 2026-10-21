import { processDocumentJob } from "../jobs/process-document";
import { pruneAnalyticsHistory } from "../analytics/history";
import { indexBriefJob } from "../jobs/index-brief";
import { cleanupOrphanedStorageUploads } from "../jobs/cleanup-storage";
import { recoverPendingBriefs, recoverPendingDocuments } from "../jobs/recover-indexes";
import { inngest } from "./client";
import { briefIndexingRequested, documentIndexingRequested } from "./events";

export const HOUSEKEEPING_CRON = "*/15 * * * *";

const processDocument = inngest.createFunction(
  {
    id: "process-document",
    retries: 1,
    triggers: [documentIndexingRequested],
    concurrency: { limit: 3 },
  },
  async ({ event }) => processDocumentJob(event.data.documentId),
);

const indexBrief = inngest.createFunction(
  {
    id: "index-brief",
    retries: 1,
    triggers: [briefIndexingRequested],
    concurrency: { limit: 3 },
  },
  async ({ event }) => indexBriefJob(event.data.briefId),
);

const requeuePendingBriefs = inngest.createFunction(
  { id: "requeue-pending-briefs", triggers: [{ cron: HOUSEKEEPING_CRON }] },
  async () =>
    recoverPendingBriefs((briefId) => inngest.send(briefIndexingRequested.create({ briefId }))),
);

const requeueStaleDocumentIndexes = inngest.createFunction(
  { id: "requeue-stale-document-indexes", triggers: [{ cron: HOUSEKEEPING_CRON }] },
  async () =>
    recoverPendingDocuments((documentId) =>
      inngest.send(documentIndexingRequested.create({ documentId })),
    ),
);
const cleanupStorage = inngest.createFunction(
  { id: "cleanup-orphaned-uploads", triggers: [{ cron: "0 2 * * *" }] },
  async () => cleanupOrphanedStorageUploads(),
);

const cleanupAnalyticsHistory = inngest.createFunction(
  { id: "cleanup-analytics-history", triggers: [{ cron: "0 2 * * *" }] },
  async () => ({ deleted: await pruneAnalyticsHistory() }),
);

export const functions = [
  processDocument,
  indexBrief,
  requeuePendingBriefs,
  requeueStaleDocumentIndexes,
  cleanupStorage,
  cleanupAnalyticsHistory,
];
