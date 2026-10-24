import type { StorageOptions } from "./types";

export class ImageOperationError extends Error {
  constructor(
    public readonly code:
      | "timeout"
      | "storage"
      | "validation"
      | "busy"
      | "processor"
      | "conflict"
      | "unknown"
      | "cancelled",
    public readonly retryable = false,
    public readonly requestId?: string,
  ) {
    super(code);
    this.name = "ImageOperationError";
  }
}

export function operationScope(options: StorageOptions = {}, fallbackMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ImageOperationError("timeout", true)),
    options.timeoutMs ?? fallbackMs,
  );
  const relay = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", relay, { once: true });
  if (options.signal?.aborted) relay();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", relay);
    },
  };
}

/** The deadline covers headers AND consumption. Cancelling closes the upstream S3 socket. */
export function boundedStream(
  source: ReadableStream<Uint8Array>,
  scope: ReturnType<typeof operationScope>,
  idleMs = 5_000,
) {
  const reader = source.getReader();
  let idle: ReturnType<typeof setTimeout>;
  let ended = false;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    ended = true;
    clearTimeout(idle);
    scope.dispose();
    scope.signal.removeEventListener("abort", abort);
  };
  const abort = () => {
    if (ended) return;
    output.error(
      scope.signal.aborted
        ? scope.signal.reason instanceof ImageOperationError
          ? scope.signal.reason
          : new ImageOperationError("cancelled", true)
        : new ImageOperationError("timeout", true),
    );
    finish();
    // Stream cancellation releases pending reads; no application work runs after cancellation.
    void reader.cancel().catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      scope.signal.addEventListener("abort", abort, { once: true });
      if (scope.signal.aborted) abort();
    },
    async pull(controller) {
      if (ended) return;
      idle = setTimeout(abort, idleMs);
      try {
        const chunk = await reader.read();
        clearTimeout(idle);
        if (ended) return;
        if (chunk.done) {
          finish();
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch (error) {
        if (!ended) {
          finish();
          controller.error(
            error instanceof ImageOperationError ? error : new ImageOperationError("storage", true),
          );
        }
      }
    },
    async cancel() {
      finish();
      await reader.cancel();
    },
  });
}

export async function readStorageBytes(
  body: ReadableStream<Uint8Array>,
  expected: number,
  options: StorageOptions = {},
) {
  const reader = boundedStream(body, operationScope(options)).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected) {
        await reader.cancel();
        throw new ImageOperationError("validation");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expected) throw new ImageOperationError("validation");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function imageErrorMessage(error: unknown): string {
  const code = error instanceof ImageOperationError ? error.code : "unknown";
  return {
    timeout: "Əməliyyatın vaxtı bitdi. Vəziyyəti yoxlayın və yenidən cəhd edin.",
    storage: "Şəkil yaddaşı müvəqqəti əlçatan deyil. Yenidən cəhd edin.",
    validation: "Şəklin formatını, ölçüsünü və bütövlüyünü yoxlayın.",
    busy: "Şəkil emalı məşğuldur. Bir az sonra yenidən cəhd edin.",
    processor: "Şəkli yoxlamaq mümkün olmadı. Yenidən cəhd edin.",
    conflict: "Bu əməliyyat artıq dəyişdirilib. Vəziyyəti yeniləyin.",
    cancelled: "Şəklin yüklənməsi ləğv edilib.",
    unknown: "Nəticəni təsdiqləmək mümkün olmadı. Yenidən yaratmadan əvvəl vəziyyəti yoxlayın.",
  }[code];
}
