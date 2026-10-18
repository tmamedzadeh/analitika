import { processDocumentJob } from "../jobs/process-document";
import { runOsintJob } from "../jobs/run-osint";
import { indexBriefJob } from "../jobs/index-brief";
import { inngest } from "./client";
import { briefIndexingRequested, documentIndexingRequested, osintRunRequested } from "./events";

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

const indexBrief = inngest.createFunction(
  {
    id: "index-brief",
    triggers: [briefIndexingRequested],
    concurrency: { limit: 1, key: "event.data.briefId" },
  },
  async ({ event }) => indexBriefJob(event.data.briefId),
);

export const functions = [processDocument, runOsint, indexBrief];
