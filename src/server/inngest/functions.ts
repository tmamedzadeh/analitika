import { processDocumentJob } from "../jobs/process-document";
import { runOsintJob } from "../jobs/run-osint";
import { inngest } from "./client";
import { documentIndexingRequested, osintRunRequested } from "./events";

const processDocument = inngest.createFunction(
  {
    id: "process-document",
    triggers: [documentIndexingRequested],
    concurrency: { limit: 1, key: "event.data.documentId" },
  },
  async ({ event }) => processDocumentJob(event.data.documentId),
);

const runOsint = inngest.createFunction(
  {
    id: "run-osint",
    triggers: [osintRunRequested],
    concurrency: { limit: 4, key: "event.data.runId" },
  },
  async ({ event }) => runOsintJob(event.data.runId),
);

export const functions = [processDocument, runOsint];
