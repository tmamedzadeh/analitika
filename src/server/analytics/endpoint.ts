import { randomUUID } from "node:crypto";
import { AuthorizationError, canAccessClassification, getCurrentUser } from "@/server/auth";
import type { Clearance } from "@/lib/classification";

import { ANALYTICS_SERVER_DEADLINE_MS, analyticsSearchRequestSchema } from "@/lib/analytics";
import type {
  AnalyticsProgressStage,
  AnalyticsSource,
  AnalyticsSourcePreview,
} from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { createGeminiProviders } from "@/server/ai/gemini";
import {
  getGeminiErrorCategory,
  getGeminiFailureInfo,
  isGeminiQuotaError,
} from "@/server/ai/gemini-gateway";
import {
  logAiDiagnostic,
  withAiDiagnostics,
  type AiDiagnosticEvent,
} from "@/server/ai/diagnostics";
import {
  analyticsPublicationFailureReasons,
  canPublishAnalyticsAnswer,
  validateCitations,
} from "./citations";
import { consumeAnalyticsRateLimit } from "./rate-limit";
import { withAnalyticsAbort } from "./abort";
import { searchDocumentChunks } from "./search";
import { prepareAnalyticsContext } from "./context-expansion";
import { contextChunks, type AnalyticsContext } from "./context-identity";
import { buildAnalyticsPrompt } from "../prompts/analytics";
import { getAppConfig } from "@/server/config";
import {
  requireAnalyticsSourceAccess,
  sameAnalyticsSourceSet,
  withAnalyticsSourceAccess,
} from "./source-access";
import {
  buildAnalyticsHistorySnapshot,
  createAnalyticsHistoryRecord,
  updateAnalyticsHistoryRecord,
} from "./history";

const encoder = new TextEncoder();

function jsonError(status: number, message: string, requestId: string): Response {
  return Response.json(
    { message, requestId },
    { status, headers: { "cache-control": "no-store", "x-analytics-request-id": requestId } },
  );
}

function eventStream(body: ReadableStream<Uint8Array>, requestId: string): Response {
  return new Response(body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-analytics-request-id": requestId,
    },
  });
}

function answerFailureMessage(error: unknown): string {
  if (getGeminiErrorCategory(error) === "provider_unavailable")
    return az.analytics.providerUnavailable;
  if (!isGeminiQuotaError(error)) return az.analytics.answerFailed;
  return az.analytics.quotaExceeded;
}

export async function handleAnalyticsSearchRequest(request: Request): Promise<Response> {
  const headerId = request.headers.get("x-vercel-id");
  const requestId = headerId && /^[a-zA-Z0-9-]{1,128}$/.test(headerId) ? headerId : randomUUID();
  const startedAt = Date.now();
  // Include rate-limit DB reads and request-body parsing in the same absolute budget.
  const preflight = new AbortController();
  const abort = () => preflight.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(
    () => preflight.abort(new DOMException("Analytics deadline exceeded.", "TimeoutError")),
    ANALYTICS_SERVER_DEADLINE_MS,
  );
  return withAiDiagnostics({ requestId, startedAt, stage: "retrieval" }, async () => {
    try {
      return await handleAnalyticsSearch(request, requestId, startedAt, preflight.signal);
    } catch (error) {
      if (!preflight.signal.aborted) throw error;
      const timedOut = getGeminiErrorCategory(error, preflight.signal) === "timeout";
      return timedOut
        ? jsonError(504, az.analytics.searchFailed, requestId)
        : new Response(null, { status: 499, headers: { "x-analytics-request-id": requestId } });
    } finally {
      clearTimeout(deadline);
      request.signal.removeEventListener("abort", abort);
    }
  });
}

async function handleAnalyticsSearch(
  request: Request,
  requestId: string,
  startedAt: number,
  preflightSignal: AbortSignal,
): Promise<Response> {
  if (!(await withAnalyticsAbort(() => consumeAnalyticsRateLimit(request), preflightSignal))) {
    return jsonError(429, az.analytics.rateLimited, requestId);
  }

  let rawInput: unknown;
  try {
    rawInput = await withAnalyticsAbort(() => request.json(), preflightSignal);
  } catch {
    preflightSignal.throwIfAborted();
    return jsonError(400, az.analytics.invalidRequest, requestId);
  }

  const parsed = analyticsSearchRequestSchema.safeParse(rawInput);
  if (!parsed.success) return jsonError(400, az.analytics.invalidRequest, requestId);

  const { query, filters, mode } = parsed.data;
  const historyId = randomUUID();
  const user = getCurrentUser();
  // Questions carry the clearance at which they entered the request. An
  // account downgrade must also revoke answers derived from that question.
  const canUseQuestion = (liveClearance: string) =>
    canAccessClassification({ clearance: liveClearance as Clearance }, user.clearance);
  let model = "";
  let activeStage: NonNullable<AiDiagnosticEvent["stage"]> = "retrieval";
  let activeAttempt = 0;
  const aborter = new AbortController();
  // Keep both generation attempts inside the deployed 120-second function limit.
  const deadline = setTimeout(
    () => {
      withAiDiagnostics({ requestId, startedAt, stage: activeStage }, () =>
        logAiDiagnostic({
          event: "deadline",
          attempt: activeAttempt,
          errorCategory: "timeout",
          timeoutScope: "overall",
        }),
      );
      aborter.abort(new DOMException("Analytics deadline exceeded.", "TimeoutError"));
    },
    Math.max(0, startedAt + ANALYTICS_SERVER_DEADLINE_MS - Date.now()),
  );
  const abortedHistoryStatus = () =>
    getGeminiErrorCategory(aborter.signal.reason, aborter.signal) === "timeout"
      ? ("failed" as const)
      : ("cancelled" as const);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // A delayed insert must precede its terminal update, including after a timeout.
  const historyCreated = createAnalyticsHistoryRecord({
    id: historyId,
    createdBy: user.id,
    query,
    filters,
  }).then(
    () => true,
    () => false,
  );
  type HistoryOutcome = Parameters<typeof updateAnalyticsHistoryRecord>[1];
  let finalHistory: HistoryOutcome | undefined;
  let historyWrite: Promise<void> | undefined;
  const saveHistory = async (input: Parameters<typeof updateAnalyticsHistoryRecord>[1]) => {
    const outcome = finalHistory ?? input;
    historyWrite ??= historyCreated
      .then(async (created) => {
        if (created) await updateAnalyticsHistoryRecord(historyId, outcome);
      })
      .catch(() => {});
    try {
      await withAnalyticsAbort(() => historyWrite!, aborter.signal);
    } catch {
      // History persistence is best-effort and must not block a live response.
    }
  };
  const abortFromRequest = () => {
    clearTimeout(deadline);
    aborter.abort(request.signal.reason);
    if (heartbeat) clearInterval(heartbeat);
    void saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
  };
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });
  let sources: AnalyticsSource[] = [];
  let expandedContext: AnalyticsContext | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let terminalSent = false;
      const close = () => {
        if (closed) return;
        // A server deadline still needs a terminal event on a connected SSE stream.
        if (aborter.signal.aborted && abortedHistoryStatus() === "failed" && !terminalSent) {
          send({ type: "error", message: az.analytics.answerFailed, requestId });
        }
        closed = true;
        clearTimeout(deadline);
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", abortFromRequest);
        try {
          controller.close();
        } catch {
          /* Stream was cancelled by the client. */
        }
      };
      const send = (event: Record<string, unknown>) => {
        const deadlineError =
          event["type"] === "error" &&
          abortedHistoryStatus() === "failed" &&
          !request.signal.aborted;
        if (
          closed ||
          terminalSent ||
          (aborter.signal.aborted && !deadlineError) ||
          controller.desiredSize === null
        )
          return false;
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
          if (event["type"] === "error" || event["type"] === "final") terminalSent = true;
          if (event["type"] === "final") {
            const snapshot = buildAnalyticsHistorySnapshot(
              sources,
              String(event["answer"] ?? ""),
              model,
              Date.now() - startedAt,
              new Date(startedAt),
              expandedContext,
            );
            finalHistory = {
              status: "done",
              answer: String(event["answer"] ?? ""),
              sources: snapshot.snapshots,
              maxClassification: snapshot.maxClassification,
              model,
              durationMs: Date.now() - startedAt,
            };
          }
          return true;
        } catch {
          aborter.abort(new Error("client disconnected"));
          return false;
        }
      };
      const progress = (stage: AnalyticsProgressStage) => send({ type: "progress", stage });
      heartbeat = setInterval(() => {
        if (controller.desiredSize === null || aborter.signal.aborted) {
          if (heartbeat) clearInterval(heartbeat);
          if (controller.desiredSize === null && !aborter.signal.aborted)
            aborter.abort(new Error("client disconnected"));
          return;
        }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          aborter.abort();
        }
      }, 15_000);
      void (async () => {
        progress("starting");
        try {
          await withAnalyticsAbort(() => historyCreated, aborter.signal);
          aborter.signal.throwIfAborted();
          progress("retrieval");
          const providers = createGeminiProviders();
          model = providers.analytics.model;
          sources = await withAnalyticsAbort(
            () => searchDocumentChunks(query, filters, { signal: aborter.signal }),
            aborter.signal,
          );
        } catch (error) {
          if (!aborter.signal.aborted) {
            logAiDiagnostic({
              event: "failure",
              stage: "retrieval",
              providerStatus: getGeminiFailureInfo(error).statusCode,
              errorCategory: getGeminiErrorCategory(error),
            });
            send({ type: "error", message: az.analytics.searchFailed, requestId });
          }
          await saveHistory({
            status: aborter.signal.aborted ? abortedHistoryStatus() : "failed",
            durationMs: Date.now() - startedAt,
          });
          close();
          return;
        }
        if (aborter.signal.aborted) {
          await saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
          close();
          return;
        }
        const retrievedCount = sources.length;
        activeStage = "source_access_before_prompt";
        progress("sources");
        try {
          await withAnalyticsAbort(
            () =>
              withAnalyticsSourceAccess(sources, user.id, (available, liveClearance) => {
                aborter.signal.throwIfAborted();
                if (!canUseQuestion(liveClearance)) throw new AuthorizationError();
                sources = available;
                const sourcePreviews: AnalyticsSourcePreview[] = sources.map(
                  ({ text: _text, charStart: _charStart, charEnd: _charEnd, ...source }) => source,
                );
                send({ type: "sources", sources: sourcePreviews });
              }),
            aborter.signal,
          );
        } catch (error) {
          if (aborter.signal.aborted) {
            await saveHistory({
              status: abortedHistoryStatus(),
              durationMs: Date.now() - startedAt,
            });
            close();
            return;
          }
          logAiDiagnostic({
            event: "failure",
            stage: "source_access_before_prompt",
            model,
            errorCategory: getGeminiErrorCategory(error),
          });
          await saveHistory({
            status: "failed",
            sources: [],
            answer: "",
            maxClassification: "open",
          });
          send({ type: "error", message: az.analytics.answerFailed, requestId });
          close();
          return;
        }
        if (aborter.signal.aborted) {
          await saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
          close();
          return;
        }
        if (sources.length !== retrievedCount) {
          logAiDiagnostic({
            event: "rejected",
            stage: "source_access_before_prompt",
            model,
            errorCategory: "source_access_changed",
          });
        }
        const denyRevokedSources = async () => {
          if (aborter.signal.aborted) {
            await saveHistory({
              status: abortedHistoryStatus(),
              durationMs: Date.now() - startedAt,
            });
            close();
            return;
          }
          logAiDiagnostic({
            event: "failure",
            stage: "source_access_before_publish",
            model,
            errorCategory: "source_access_changed",
          });
          await saveHistory({
            status: "failed",
            answer: "",
            sources: [],
            maxClassification: "open",
            model,
            durationMs: Date.now() - startedAt,
          });
          send({ type: "error", message: az.analytics.answerFailed, requestId });
          close();
        };
        if (sources.length === 0) {
          model = "";
          const answer = az.analytics.noSources;
          const publication = await withAnalyticsAbort(
            () =>
              withAnalyticsSourceAccess(sources, user.id, (_available, liveClearance) => {
                if (!canUseQuestion(liveClearance)) return false;
                return send({
                  type: "final",
                  answer,
                  incomplete: false,
                  durationMs: Date.now() - startedAt,
                  model,
                });
              }),
            aborter.signal,
          ).catch(() => ({ value: false }));
          if (!publication.value) {
            await denyRevokedSources();
            return;
          }
          const snapshot = buildAnalyticsHistorySnapshot(
            sources,
            answer,
            model,
            Date.now() - startedAt,
            new Date(startedAt),
            expandedContext,
          );
          await saveHistory({
            status: "done",
            answer,
            sources: snapshot.snapshots,
            maxClassification: snapshot.maxClassification,
            model,
            durationMs: Date.now() - startedAt,
          });
          close();
          return;
        }

        if (mode === "sources") {
          model = "";
          activeStage = "source_access_before_publish";
          const finalPublication = await withAnalyticsAbort(
            () =>
              withAnalyticsSourceAccess(sources, user.id, (available, liveClearance) => {
                if (!canUseQuestion(liveClearance) || !sameAnalyticsSourceSet(sources, available))
                  return false;
                sources = available;
                return send({
                  type: "final",
                  answer: "",
                  incomplete: false,
                  durationMs: Date.now() - startedAt,
                  model,
                });
              }),
            aborter.signal,
          ).catch(() => ({ value: false }));
          if (!finalPublication.value) {
            await denyRevokedSources();
            return;
          }
          const snapshot = buildAnalyticsHistorySnapshot(
            sources,
            "",
            model,
            Date.now() - startedAt,
            new Date(startedAt),
            expandedContext,
          );
          await saveHistory({
            status: "done",
            answer: "",
            sources: snapshot.snapshots,
            maxClassification: snapshot.maxClassification,
            model,
            durationMs: Date.now() - startedAt,
          });
          close();
          return;
        }

        try {
          // The existing sources stage includes optional preparation; no synthetic UI stage.
          const config = getAppConfig();
          expandedContext = await prepareAnalyticsContext(sources, user, {
            enabled: Boolean(config.enableContextExpansion),
            embeddingModel: config.embeddingModel,
            signal: aborter.signal,
          });
          aborter.signal.throwIfAborted();
          activeStage = "generation";
          const providers = createGeminiProviders();
          const prompt = expandedContext
            ? buildAnalyticsPrompt(
                query,
                sources,
                config.analyticsThinkingLevel,
                expandedContext.auxiliary,
              )
            : buildAnalyticsPrompt(query, sources, config.analyticsThinkingLevel);
          let validatedAnswer: ReturnType<typeof validateCitations> | null = null;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            aborter.signal.throwIfAborted();
            activeStage = "generation";
            progress("generation");
            activeAttempt = attempt + 1;
            const generationPrompt =
              attempt === 0
                ? prompt
                : {
                    ...prompt,
                    maxOutputTokens: 6144,
                    system:
                      prompt.system +
                      "\nTam və boş olmayan cavab yaz. Yalnız təqdim edilmiş mənbə nömrələrinə [1], [2] formatında istinad et. Mənbə URL-ləri yazma.",
                    prompt:
                      prompt.prompt +
                      "\n\nİcazəli istinadlar: " +
                      sources.map(({ n }) => `[${n}]`).join(", ") +
                      ". Cavabı və bütün istinadları tamamla.",
                  };
            const generated = await withAnalyticsAbort(
              () =>
                withAiDiagnostics({ stage: "generation", generationAttempt: activeAttempt }, () =>
                  providers.analytics.generateTextWithMetadata({
                    ...generationPrompt,
                    signal: aborter.signal,
                    deadlineAt: startedAt + ANALYTICS_SERVER_DEADLINE_MS,
                    onFallback: (fallback) => send({ type: "model-fallback", fallback }),
                    beforeRequest: async () => {
                      sources = await requireAnalyticsSourceAccess(
                        sources,
                        user,
                        expandedContext ? contextChunks(expandedContext) : [],
                      );
                      aborter.signal.throwIfAborted();
                    },
                  }),
                ),
              aborter.signal,
            );
            aborter.signal.throwIfAborted();
            if (generated.model) model = generated.model;
            activeStage = "answer_validation";
            progress("validation");
            const validated = validateCitations(generated.text, sources);
            const publishable = canPublishAnalyticsAnswer(
              generated.text,
              generated.finishReason,
              validated,
            );
            logAiDiagnostic({
              event: publishable ? "success" : "rejected",
              stage: "answer_validation",
              model,
              attempt: activeAttempt,
              providerStatus: 200,
              ...(publishable ? {} : { errorCategory: "validation" as const }),
              finishReason: generated.finishReason,
              validationFailureReasons: analyticsPublicationFailureReasons(
                generated.text,
                generated.finishReason,
                validated,
              ),
            });
            if (publishable) {
              validatedAnswer = validated;
              break;
            }
          }
          if (!validatedAnswer) {
            send({ type: "error", message: az.analytics.answerFailed, requestId });
            const snapshot = buildAnalyticsHistorySnapshot(
              sources,
              "",
              model,
              Date.now() - startedAt,
              new Date(startedAt),
              expandedContext,
            );
            await saveHistory({
              status: "failed",
              sources: snapshot.snapshots,
              maxClassification: snapshot.maxClassification,
              model,
              durationMs: Date.now() - startedAt,
            });
            close();
            return;
          }

          activeStage = "source_access_before_publish";
          const finalPublication = await withAnalyticsAbort(
            () =>
              withAnalyticsSourceAccess(
                sources,
                user.id,
                (available, liveClearance) => {
                  if (!canUseQuestion(liveClearance) || !sameAnalyticsSourceSet(sources, available))
                    return false;
                  sources = available;
                  return send({
                    type: "final",
                    answer: validatedAnswer.answer,
                    incomplete: false,
                    durationMs: Date.now() - startedAt,
                    model,
                  });
                },
                expandedContext ? contextChunks(expandedContext) : [],
              ),
            aborter.signal,
          );
          if (!finalPublication.value) {
            await denyRevokedSources();
            return;
          }
          const snapshot = buildAnalyticsHistorySnapshot(
            sources,
            validatedAnswer.answer,
            model,
            Date.now() - startedAt,
            new Date(startedAt),
            expandedContext,
          );
          await saveHistory({
            status: "done",
            answer: validatedAnswer.answer,
            sources: snapshot.snapshots,
            maxClassification: snapshot.maxClassification,
            model,
            durationMs: Date.now() - startedAt,
          });
        } catch (error) {
          if (error instanceof AuthorizationError) {
            await denyRevokedSources();
            return;
          } else if (aborter.signal.aborted) {
            await saveHistory({
              status: abortedHistoryStatus(),
              durationMs: Date.now() - startedAt,
            });
          } else {
            logAiDiagnostic({
              event: "failure",
              stage: activeStage,
              attempt: activeAttempt,
              providerStatus: getGeminiFailureInfo(error).statusCode,
              errorCategory: getGeminiErrorCategory(error),
            });
            const snapshot = buildAnalyticsHistorySnapshot(
              sources,
              "",
              model,
              Date.now() - startedAt,
              new Date(startedAt),
              expandedContext,
            );
            await saveHistory({
              status: "failed",
              sources: snapshot.snapshots,
              maxClassification: snapshot.maxClassification,
              model,
              durationMs: Date.now() - startedAt,
            });
            send({
              type: "error",
              message:
                activeStage === "generation"
                  ? answerFailureMessage(error)
                  : az.analytics.answerFailed,
              requestId,
            });
          }
        } finally {
          close();
        }
      })().catch(async (error) => {
        await saveHistory({
          status: aborter.signal.aborted ? abortedHistoryStatus() : "failed",
          durationMs: Date.now() - startedAt,
        });
        if (!aborter.signal.aborted)
          logAiDiagnostic({
            event: "failure",
            stage: "stream",
            model,
            errorCategory: getGeminiErrorCategory(error),
          });
        if (!aborter.signal.aborted)
          send({ type: "error", message: az.analytics.answerFailed, requestId });
        close();
      });
    },
    cancel() {
      clearTimeout(deadline);
      if (heartbeat) clearInterval(heartbeat);
      aborter.abort(new Error("client disconnected"));
      void saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
      request.signal.removeEventListener("abort", abortFromRequest);
    },
  });

  return eventStream(body, requestId);
}
