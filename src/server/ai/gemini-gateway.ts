export type GeminiQuotaKey = "GEMINI_CHAT_MODEL" | "GEMINI_LIGHT_MODEL" | "GEMINI_EMBED_MODEL";
export type GeminiLimitKind = "per-minute" | "per-day" | "tokens" | "search-requests" | "unknown";
export type GeminiAttemptLimit = 1 | 2 | 3;

const MAX_CONCURRENT_REQUESTS = 3;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

let activeRequests = 0;
const waitingRequests: Array<() => void> = [];

export class GeminiQuotaExceededError extends Error {
  constructor(
    readonly quotaKey: GeminiQuotaKey,
    readonly limitKind: GeminiLimitKind = "unknown",
  ) {
    super(`Gemini quota exhausted for ${quotaKey}.`);
    this.name = "GeminiQuotaExceededError";
  }
}

export class GeminiRequestBudgetExceededError extends Error {
  constructor() {
    super("Gemini request budget exhausted.");
    this.name = "GeminiRequestBudgetExceededError";
  }
}

export class GeminiRequestBudget {
  calls = 0;

  constructor(
    readonly maxCalls: number,
    private readonly onCall?: (calls: number) => void,
  ) {}

  reserve(): void {
    if (this.calls >= this.maxCalls) throw new GeminiRequestBudgetExceededError();
    this.calls += 1;
    this.onCall?.(this.calls);
  }
}

async function acquireRequestSlot(): Promise<() => void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) activeRequests += 1;
  else await new Promise<void>((resolve) => waitingRequests.push(resolve));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waitingRequests.shift();
    if (next) next();
    else activeRequests -= 1;
  };
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value["statusCode"] === "number") return value["statusCode"];
  if (typeof value["status"] === "number") return value["status"];
  return undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as Record<string, unknown>)["responseHeaders"];
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

function limitKind(error: unknown): GeminiLimitKind {
  if (!error || typeof error !== "object") return "unknown";
  const raw = (error as Record<string, unknown>)["responseBody"];
  if (typeof raw !== "string") return "unknown";
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "unknown";
  }
  const signals: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && /quota|reason|status|message/i.test(key)) {
        signals.push(item.toLowerCase());
      }
      if (typeof item === "object") visit(item, depth + 1);
    }
  };
  visit(body);
  const signal = signals.join(" ");
  if (/token|tpm/.test(signal)) return "tokens";
  if (/per[_ ]?day|perday|daily|rpd/.test(signal)) return "per-day";
  if (/per[_ ]?minute|perminute|minute|rpm/.test(signal)) return "per-minute";
  if (/grounding|google.?search|search.?requests?/.test(signal)) return "search-requests";
  return "unknown";
}

export function isGeminiQuotaError(error: unknown): boolean {
  if (error instanceof GeminiQuotaExceededError || statusCode(error) === 429) return true;
  if (!error || typeof error !== "object") return false;
  return /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(
    String((error as Record<string, unknown>)["message"] ?? ""),
  );
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withGeminiRequest<T>(
  quotaKey: GeminiQuotaKey,
  operation: () => Promise<T>,
  budget?: GeminiRequestBudget,
  maxAttempts: GeminiAttemptLimit = MAX_ATTEMPTS,
): Promise<T> {
  let kind: GeminiLimitKind = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const release = await acquireRequestSlot();
    let failure: unknown;
    try {
      budget?.reserve();
      return await operation();
    } catch (error) {
      failure = error;
    } finally {
      release();
    }

    if (!isGeminiQuotaError(failure)) throw failure;
    kind = limitKind(failure);
    const delay = Math.max(500 * 2 ** (attempt - 1), retryAfterMs(failure) ?? 0);
    if (attempt >= maxAttempts || delay > MAX_RETRY_DELAY_MS) {
      throw new GeminiQuotaExceededError(quotaKey, kind);
    }
    await pause(delay);
  }
  throw new GeminiQuotaExceededError(quotaKey, kind);
}

export async function* withGeminiStream<T>(
  quotaKey: GeminiQuotaKey,
  createStream: () => Promise<AsyncIterable<T>>,
  budget?: GeminiRequestBudget,
  maxAttempts: GeminiAttemptLimit = MAX_ATTEMPTS,
): AsyncGenerator<T> {
  let kind: GeminiLimitKind = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const release = await acquireRequestSlot();
    let emitted = false;
    let failure: unknown;
    try {
      budget?.reserve();
      for await (const value of await createStream()) {
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
    kind = limitKind(failure);
    if (emitted || attempt >= maxAttempts) throw new GeminiQuotaExceededError(quotaKey, kind);
    const delay = Math.max(500 * 2 ** (attempt - 1), retryAfterMs(failure) ?? 0);
    if (delay > MAX_RETRY_DELAY_MS) throw new GeminiQuotaExceededError(quotaKey, kind);
    await pause(delay);
  }
  throw new GeminiQuotaExceededError(quotaKey, kind);
}

export function getGeminiQuotaKey(error: unknown): GeminiQuotaKey | undefined {
  return error instanceof GeminiQuotaExceededError ? error.quotaKey : undefined;
}
