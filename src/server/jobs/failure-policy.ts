import { NonRetriableError } from "inngest";

import { getGeminiFailureInfo, isGeminiQuotaError } from "@/server/ai/gemini-gateway";

const TEMPORARY_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  "ERR_NETWORK",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function isTemporaryWorkerFailure(error: unknown): boolean {
  if (isGeminiQuotaError(error)) return false;
  const { statusCode } = getGeminiFailureInfo(error);
  if (statusCode !== undefined) return statusCode >= 500 && statusCode <= 599;

  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { cause?: unknown; code?: unknown; name?: unknown; message?: unknown };
    if (typeof value.code === "string" && TEMPORARY_NETWORK_CODES.has(value.code)) return true;
    if (value.name === "TimeoutError") return true;
    if (
      typeof value.message === "string" &&
      /fetch failed|network error|timed? ?out|socket hang up/i.test(value.message)
    ) {
      return true;
    }
    current = value.cause;
  }
  return false;
}

export function nonRetriableJobError(message: string): NonRetriableError {
  return new NonRetriableError(message);
}
