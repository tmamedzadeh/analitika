import { Inngest } from "inngest";
import { documentIndexingRequested } from "../inngest/events";

/** Existing queued rows/recovery are durable. No detached promise or photo event. */
export async function dispatchCreatedDocument(
  documentId: string,
  deduplicateCreation = true,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  const publisher = new Inngest({
    id: "analitika",
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal,
      }),
  });
  try {
    // The SDK's bounded five-attempt backoff adds at most 1.9s after the abort.
    const event = documentIndexingRequested.create({ documentId });
    await publisher.send(
      deduplicateCreation ? { ...event, id: `document-created:${documentId}` } : event,
    );
    return false;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}
