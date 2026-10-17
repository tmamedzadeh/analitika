import { processDocumentJob } from "../jobs/process-document";
import { inngest } from "./client";
import { documentIndexingRequested } from "./events";

const processDocument = inngest.createFunction(
  {
    id: "process-document",
    triggers: [documentIndexingRequested],
    concurrency: { limit: 1, key: "event.data.documentId" },
  },
  async ({ event }) => processDocumentJob(event.data.documentId),
);

export const functions = [processDocument];
