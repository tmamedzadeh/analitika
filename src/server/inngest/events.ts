import { eventType } from "inngest";
import { z } from "zod";

export const documentIndexingRequested = eventType("document/indexing.requested", {
  schema: z.object({ documentId: z.string().uuid() }),
});

export const briefIndexingRequested = eventType("brief/indexing.requested", {
  schema: z.object({ briefId: z.string().uuid() }),
});
