export type GeminiQuotaKey = "AI_CHAT_MODEL" | "AI_LIGHT_MODEL" | "GEMINI_EMBED_MODEL";

const MAX_CONCURRENT_REQUESTS = 3;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const BASE_RETRY_DELAY_MS = 500;

export type GeminiLimitKind = "per-minute" | "per-day" | "tokens" | "free-tier" | "unknown";
export type GeminiAttemptLimit = 1 | 2 | 3;

let activeRequests = 0;
type RequestWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};
const waitingRequests: RequestWaiter[] = [];

export class GeminiQuotaExceededError extends Error {
  constructor(
    readonly quotaKey: GeminiQuotaKey,
    readonly limitKind: GeminiLimitKind = "unknown",
    readonly statusCode = 429,
    readonly quotaIds: string[] = [],
    readonly quotaMetrics: string[] = [],
    readonly terminal = false,
  ) {
    super(`AI provider quota exhausted for ${quotaKey}.`);
    this.name = "GeminiQuotaExceededError";
  }
}

async function acquireRequestSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Request was aborted.");
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const waiter: RequestWaiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          const index = waitingRequests.indexOf(waiter);
          if (index >= 0) waitingRequests.splice(index, 1);
          reject(signal.reason ?? new Error("Request was aborted."));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      waitingRequests.push(waiter);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    let next: RequestWaiter | undefined;
    while ((next = waitingRequests.shift())) {
      if (next.signal?.aborted) {
        next.reject(next.signal.reason ?? new Error("Request was aborted."));
        continue;
      }
      if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
      next.resolve();
      return;
    }
    activeRequests -= 1;
  };
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  for (const key of ["statusCode", "status"]) {
    if (typeof value[key] === "number") return value[key];
  }
  return undefined;
}

function apiErrorBody(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || !error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value["responseBody"] === "string") return value["responseBody"];
  return apiErrorBody(value["cause"], depth + 1);
}

function apiErrorMessage(error: unknown, depth = 0): string {
  if (depth > 3 || !error || typeof error !== "object") return "";
  const value = error as Record<string, unknown>;
  const message = typeof value["message"] === "string" ? value["message"] : "";
  return [message, apiErrorMessage(value["cause"], depth + 1)].filter(Boolean).join(" ");
}

function quotaResponseMetadata(error: unknown): {
  ids: string[];
  metrics: string[];
  signal: string;
} {
  const body = apiErrorBody(error);
  if (!body) return { ids: [], metrics: [], signal: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ids: [], metrics: [], signal: "" };
  }

  const ids: string[] = [];
  const metrics: string[] = [];
  const signals: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string") {
        const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
        if (/^[a-zA-Z0-9_.:/-]{1,180}$/.test(item)) {
          if (normalizedKey === "quotaid") ids.push(item);
          if (normalizedKey === "quotametric") metrics.push(item);
          if (["quotaid", "quotametric", "quotatype", "reason", "status"].includes(normalizedKey)) {
            signals.push(item.toLowerCase());
          }
        } else if (normalizedKey === "message" && item.length <= 4000) {
          // Use the controlled API error message only for classification; never expose it.
          signals.push(item.toLowerCase());
        }
      }
      if (typeof item === "object") visit(item, depth + 1);
    }
  };
  visit(parsed);
  return { ids: [...new Set(ids)], metrics: [...new Set(metrics)], signal: signals.join(" ") };
}

function classifyQuotaResponse(error: unknown): GeminiLimitKind {
  const body = apiErrorBody(error) ?? "";
  if (/allocationquota\.freetieronly|free.?tier.?only/i.test(body)) return "free-tier";
  const { signal } = quotaResponseMetadata(error);
  if (/allocationquota\.freetieronly|free.?tier.?only/.test(signal)) return "free-tier";
  if (/token|tpm|input_token|output_token/.test(signal)) return "tokens";
  if (/credit|prepaid|balance/.test(signal)) return "tokens";
  if (/per[_ ]?day|perday|daily|requests?[_ ]?per[_ ]?day|rpd/.test(signal)) return "per-day";
  if (/per[_ ]?minute|perminute|minute|rpm|rate.?limit/.test(signal)) return "per-minute";
  return "unknown";
}

export function getGeminiFailureInfo(error: unknown): {
  statusCode?: number;
  quotaKey?: GeminiQuotaKey;
  limitKind?: GeminiLimitKind;
  quotaIds?: string[];
  quotaMetrics?: string[];
} {
  if (error instanceof GeminiQuotaExceededError) {
    return {
      statusCode: error.statusCode,
      quotaKey: error.quotaKey,
      limitKind: error.limitKind,
      ...(error.quotaIds.length ? { quotaIds: error.quotaIds } : {}),
      ...(error.quotaMetrics.length ? { quotaMetrics: error.quotaMetrics } : {}),
    };
  }
  const statusCode = getStatusCode(error);
  const { ids, metrics } = quotaResponseMetadata(error);
  const limitKind = classifyQuotaResponse(error);
  return {
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(statusCode === 429 || limitKind === "free-tier" ? { limitKind } : {}),
    ...(ids.length ? { quotaIds: ids } : {}),
    ...(metrics.length ? { quotaMetrics: metrics } : {}),
  };
}

export function isGeminiQuotaError(error: unknown): boolean {
  if (error instanceof GeminiQuotaExceededError) return true;
  const statusCode = getStatusCode(error);
  if (statusCode === 429) return true;
  const message = apiErrorMessage(error);
  const body = apiErrorBody(error) ?? "";
  const { signal } = quotaResponseMetadata(error);
  const details = `${message}\n${signal}\n${body}`;
  const freeTier = /AllocationQuota\.FreeTierOnly|free.?tier.?only/i.test(details);
  if (statusCode === 401) return false;
  if (statusCode === 403) return freeTier;
  if (statusCode === 402) {
    // Google uses 402 PAYMENT_REQUIRED when prepaid account credits are depleted.
    return /PAYMENT_REQUIRED|prepaid|(?:credit|balance).{0,60}(?:exhausted|depleted|insufficient|empty)|insufficient.{0,60}(?:credits?|balance)/i.test(
      details,
    );
  }
  if (
    /RESOURCE[_ -]?EXHAUSTED|QUOTA[_ -]?(?:EXCEEDED|EXHAUSTED)|RATE[_ -]?LIMIT[_ -]?(?:EXCEEDED)?|AllocationQuota\.FreeTierOnly|free.?tier.?only/i.test(
      details,
    ) ||
    /(?:exceeded|exhausted|depleted).{0,60}quota|quota.{0,60}(?:exceeded|exhausted|depleted)|too many requests/i.test(
      details,
    )
  ) {
    return true;
  }
  return false;
}

export function isTerminalQuotaError(error: unknown): boolean {
  if (error instanceof GeminiQuotaExceededError) return error.terminal;
  const body = apiErrorBody(error) ?? "";
  return /AllocationQuota\.FreeTierOnly|free.?tier.?only/i.test(body);
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const headers = value["responseHeaders"];
  if (!headers || typeof headers !== "object") return undefined;
  const entry = Object.entries(headers as Record<string, unknown>).find(
    ([name]) => name.toLowerCase() === "retry-after",
  )?.[1];
  if (typeof entry !== "string") return undefined;
  const seconds = Number(entry);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(entry);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function retryDelay(error: unknown, attempt: number): number {
  const exponential = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
  return Math.max(exponential, getRetryAfterMs(error) ?? 0);
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Request was aborted."));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Request was aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withGeminiRequest<T>(
  quotaKey: GeminiQuotaKey,
  operation: () => Promise<T>,
  maxAttempts: GeminiAttemptLimit = MAX_ATTEMPTS,
  signal?: AbortSignal,
): Promise<T> {
  let limitKind: GeminiLimitKind = "unknown";
  let statusCode = 429;
  let quotaIds: string[] = [];
  let quotaMetrics: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const release = await acquireRequestSlot(signal);
    let failure: unknown;
    try {
      return await operation();
    } catch (error) {
      failure = error;
    } finally {
      release();
    }

    if (!isGeminiQuotaError(failure)) throw failure;
    limitKind = classifyQuotaResponse(failure);
    statusCode = getStatusCode(failure) ?? 429;
    ({ ids: quotaIds, metrics: quotaMetrics } = quotaResponseMetadata(failure));
    if (limitKind === "free-tier") {
      throw new GeminiQuotaExceededError(
        quotaKey,
        limitKind,
        statusCode,
        quotaIds,
        quotaMetrics,
        true,
      );
    }
    // Non-429 resource exhaustion (for example depleted prepaid credits) is not
    // made better by retrying the same model. Let the configured fallback run.
    if (statusCode !== 429) {
      throw new GeminiQuotaExceededError(quotaKey, limitKind, statusCode, quotaIds, quotaMetrics);
    }
    const delay = retryDelay(failure, attempt);
    if (attempt >= maxAttempts || delay > MAX_RETRY_DELAY_MS) {
      throw new GeminiQuotaExceededError(quotaKey, limitKind, statusCode, quotaIds, quotaMetrics);
    }
    await pause(delay, signal);
  }
  throw new GeminiQuotaExceededError(quotaKey, limitKind, statusCode, quotaIds, quotaMetrics);
}

export async function* withGeminiStream<T>(
  quotaKey: GeminiQuotaKey,
  createStream: () => Promise<AsyncIterable<T>>,
  maxAttempts: GeminiAttemptLimit = MAX_ATTEMPTS,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  let limitKind: GeminiLimitKind = "unknown";
  let statusCode = 429;
  let quotaIds: string[] = [];
  let quotaMetrics: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const release = await acquireRequestSlot(signal);
    let emitted = false;
    let failure: unknown;
    try {
      const stream = await createStream();
      for await (const value of stream) {
        emitted = true;
        yield value;
      }
      return;
    } catch (error) {
      failure = error;
    } finally {
      release();
    }

    if (!isGeminiQuotaError(failure)) throw failure;
    limitKind = classifyQuotaResponse(failure);
    statusCode = getStatusCode(failure) ?? 429;
    ({ ids: quotaIds, metrics: quotaMetrics } = quotaResponseMetadata(failure));
    if (limitKind === "free-tier") {
      throw new GeminiQuotaExceededError(
        quotaKey,
        limitKind,
        statusCode,
        quotaIds,
        quotaMetrics,
        true,
      );
    }
    if (statusCode !== 429) {
      throw new GeminiQuotaExceededError(quotaKey, limitKind, statusCode, quotaIds, quotaMetrics);
    }
    const delay = retryDelay(failure, attempt);
    if (emitted || attempt >= maxAttempts || delay > MAX_RETRY_DELAY_MS) {
      throw new GeminiQuotaExceededError(quotaKey, limitKind, statusCode, quotaIds, quotaMetrics);
    }
    await pause(delay, signal);
  }
  throw new GeminiQuotaExceededError(quotaKey, limitKind, statusCode, quotaIds, quotaMetrics);
}

export async function withGeminiQuotaFallback<T>(
  primaryModel: string,
  fallbackModel: string | undefined,
  primary: () => Promise<T>,
  fallback?: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!isGeminiQuotaError(error)) throw error;
    if (!fallbackModel || !fallback || fallbackModel === primaryModel) throw error;
    console.warn(`[AI] model=${primaryModel} quota_exhausted fallback=${fallbackModel}`);
    return fallback();
  }
}

export async function* withGeminiQuotaFallbackStream<T>(
  primaryStream: AsyncIterable<T>,
  primaryModel: string,
  fallbackModel: string | undefined,
  fallback?: () => Promise<AsyncIterable<T>>,
): AsyncGenerator<T> {
  let emitted = false;
  try {
    for await (const value of primaryStream) {
      emitted = true;
      yield value;
    }
  } catch (error) {
    if (!isGeminiQuotaError(error) || emitted) throw error;
    if (!fallbackModel || !fallback || fallbackModel === primaryModel) throw error;
    console.warn(`[AI] model=${primaryModel} quota_exhausted fallback=${fallbackModel}`);
    for await (const value of await fallback()) yield value;
  }
}

export function getGeminiQuotaKey(error: unknown): GeminiQuotaKey | undefined {
  return error instanceof GeminiQuotaExceededError ? error.quotaKey : undefined;
}
