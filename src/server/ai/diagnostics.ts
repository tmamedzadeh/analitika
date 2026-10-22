import { AsyncLocalStorage } from "node:async_hooks";

type AiStage =
  | "retrieval"
  | "query_embedding"
  | "rerank"
  | "generation"
  | "answer_validation"
  | "source_access_before_prompt"
  | "source_access_before_publish"
  | "stream";

export type AiErrorCategory =
  | "timeout"
  | "cancelled"
  | "quota"
  | "provider_unavailable"
  | "provider_transient"
  | "provider_auth"
  | "provider_request"
  | "provider_error"
  | "empty_response"
  | "network"
  | "validation"
  | "source_access_changed";

type DiagnosticContext = {
  requestId: string;
  startedAt: number;
  stage: AiStage;
  generationAttempt?: number;
};

export type AiDiagnosticEvent = {
  event: "start" | "success" | "failure" | "retry" | "fallback" | "rejected" | "deadline";
  stage?: AiStage;
  model?: string | undefined;
  fallbackModel?: string;
  attempt?: number;
  providerStatus?: number | undefined;
  errorCategory?: AiErrorCategory;
  timeoutScope?: "model" | "overall";
  retryDelayMs?: number;
  finishReason?: string;
  validationFailureReasons?: readonly string[];
};

const context = new AsyncLocalStorage<Partial<DiagnosticContext>>();

export function withAiDiagnostics<T>(fields: Partial<DiagnosticContext>, operation: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, operation);
}

function safeModel(model: string | undefined): string | null {
  return model && /^[a-zA-Z0-9_./-]{1,120}$/.test(model) ? model : null;
}

export function safeFinishReason(reason: string): string {
  return ["stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"].includes(
    reason,
  )
    ? reason
    : "unknown";
}

/** Only explicitly selected metadata is logged. Never pass errors, inputs or provider results. */
export function logAiDiagnostic(event: AiDiagnosticEvent): boolean {
  const current = context.getStore();
  if (!current?.requestId || current.startedAt === undefined) return false;
  const fields = {
    requestId: current.requestId,
    stage: event.stage ?? current.stage,
    event: event.event,
    model: safeModel(event.model),
    attempt: event.attempt ?? null,
    generationAttempt: current.generationAttempt ?? null,
    providerStatus: event.providerStatus ?? null,
    errorCategory: event.errorCategory ?? null,
    ...(event.timeoutScope ? { timeoutScope: event.timeoutScope } : {}),
    elapsedMs: Math.max(0, Date.now() - current.startedAt),
    ...(event.fallbackModel ? { fallbackModel: safeModel(event.fallbackModel) } : {}),
    ...(event.retryDelayMs === undefined ? {} : { retryDelayMs: event.retryDelayMs }),
    ...(event.finishReason === undefined
      ? {}
      : { finishReason: safeFinishReason(event.finishReason) }),
    ...(event.validationFailureReasons === undefined
      ? {}
      : { validationFailureReasons: event.validationFailureReasons }),
  };
  const message = "[analytics-ai] " + JSON.stringify(fields);
  if (event.event === "failure" || event.event === "deadline") console.error(message);
  else if (["retry", "fallback", "rejected"].includes(event.event)) console.warn(message);
  else console.info(message);
  return true;
}
