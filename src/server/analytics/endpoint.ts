import { randomUUID } from "node:crypto";
import { AuthorizationError, canAccessClassification, getCurrentUser } from "@/server/auth";
import type { Clearance } from "@/lib/classification";

import { ANALYTICS_SERVER_DEADLINE_MS, analyticsSearchRequestSchema } from "@/lib/analytics";
import type { AnalyticsSource, AnalyticsSourcePreview } from "@/lib/analytics";
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
import { searchDocumentChunks } from "./search";
import { buildAnalyticsPrompt } from "../prompts/analytics";
import { getAppConfig } from "@/server/config";
import { sameAnalyticsSourceSet, withAnalyticsSourceAccess } from "./source-access";
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
  return withAiDiagnostics({ requestId, startedAt, stage: "retrieval" }, () =>
    handleAnalyticsSearch(request, requestId, startedAt),
  );
}

async function handleAnalyticsSearch(
  request: Request,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  if (!(await consumeAnalyticsRateLimit(request))) {
    return jsonError(429, az.analytics.rateLimited, requestId);
  }

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
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
  try {
    await createAnalyticsHistoryRecord({ id: historyId, createdBy: user.id, query, filters });
  } catch {
    // History persistence is best-effort and must not block a live response.
  }
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
  const saveHistory = async (input: Parameters<typeof updateAnalyticsHistoryRecord>[1]) => {
    try {
      await updateAnalyticsHistoryRecord(historyId, input);
    } catch {
      // History persistence is best-effort and must not block a live response.
    }
  };
  const abortFromRequest = () => {
    clearTimeout(deadline);
    aborter.abort(request.signal.reason);
    if (heartbeat) clearInterval(heartbeat);
    void saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
  };
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });
  let sources: AnalyticsSource[];
  try {
    const providers = createGeminiProviders();
    model = providers.analytics.model;
    sources = await searchDocumentChunks(query, filters, { signal: aborter.signal });
  } catch (error) {
    if (aborter.signal.aborted) {
      await saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
      clearTimeout(deadline);
      request.signal.removeEventListener("abort", abortFromRequest);
      return abortedHistoryStatus() === "failed"
        ? jsonError(504, az.analytics.searchFailed, requestId)
        : new Response(null, { status: 499, headers: { "x-analytics-request-id": requestId } });
    }
    logAiDiagnostic({
      event: "failure",
      stage: "retrieval",
      providerStatus: getGeminiFailureInfo(error).statusCode,
      errorCategory: getGeminiErrorCategory(error),
    });
    await saveHistory({ status: "failed", durationMs: Date.now() - startedAt });
    clearTimeout(deadline);
    request.signal.removeEventListener("abort", abortFromRequest);
    return jsonError(500, az.analytics.searchFailed, requestId);
  }
  if (aborter.signal.aborted) {
    await saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
    clearTimeout(deadline);
    request.signal.removeEventListener("abort", abortFromRequest);
    return abortedHistoryStatus() === "failed"
      ? jsonError(504, az.analytics.searchFailed, requestId)
      : new Response(null, { status: 499, headers: { "x-analytics-request-id": requestId } });
  }

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
        if (closed || (aborter.signal.aborted && !deadlineError) || controller.desiredSize === null)
          return false;
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
          if (event["type"] === "error" || event["type"] === "final") terminalSent = true;
          return true;
        } catch {
          aborter.abort(new Error("client disconnected"));
          return false;
        }
      };
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
        if (aborter.signal.aborted) {
          await saveHistory({ status: abortedHistoryStatus(), durationMs: Date.now() - startedAt });
          close();
          return;
        }
        const retrievedCount = sources.length;
        activeStage = "source_access_before_prompt";
        try {
          await withAnalyticsSourceAccess(sources, user.id, (available, liveClearance) => {
            aborter.signal.throwIfAborted();
            if (!canUseQuestion(liveClearance)) throw new AuthorizationError();
            sources = available;
            const sourcePreviews: AnalyticsSourcePreview[] = sources.map(
              ({ text: _text, charStart: _charStart, charEnd: _charEnd, ...source }) => source,
            );
            send({ type: "sources", sources: sourcePreviews });
          });
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
          send({
            type: "final",
            answer,
            incomplete: false,
            durationMs: Date.now() - startedAt,
            model,
          });
          const snapshot = buildAnalyticsHistorySnapshot(
            sources,
            answer,
            model,
            Date.now() - startedAt,
            new Date(startedAt),
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
          const finalPublication = await withAnalyticsSourceAccess(
            sources,
            user.id,
            (available, liveClearance) => {
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
            },
          );
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
          activeStage = "generation";
          const generation = await withAnalyticsSourceAccess(
            sources,
            user.id,
            async (available, liveClearance) => {
              aborter.signal.throwIfAborted();
              if (!canUseQuestion(liveClearance) || !sameAnalyticsSourceSet(sources, available)) {
                return { accessChanged: true, validatedAnswer: null };
              }
              sources = available;
              const providers = createGeminiProviders();
              const prompt = buildAnalyticsPrompt(
                query,
                sources,
                getAppConfig().analyticsThinkingLevel,
              );
              let validatedAnswer: ReturnType<typeof validateCitations> | null = null;
              for (let attempt = 0; attempt < 2; attempt += 1) {
                aborter.signal.throwIfAborted();
                activeStage = "generation";
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
                const generated = await withAiDiagnostics(
                  { stage: "generation", generationAttempt: activeAttempt },
                  () =>
                    providers.analytics.generateTextWithMetadata({
                      ...generationPrompt,
                      signal: aborter.signal,
                      deadlineAt: startedAt + ANALYTICS_SERVER_DEADLINE_MS,
                      onFallback: (fallback) => send({ type: "model-fallback", fallback }),
                    }),
                );
                aborter.signal.throwIfAborted();
                if (generated.model) model = generated.model;
                activeStage = "answer_validation";
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
              return { accessChanged: false, validatedAnswer };
            },
          );
          if (generation.value.accessChanged) {
            await denyRevokedSources();
            return;
          }
          const validatedAnswer = generation.value.validatedAnswer;

          if (!validatedAnswer) {
            send({ type: "error", message: az.analytics.answerFailed, requestId });
            const snapshot = buildAnalyticsHistorySnapshot(
              sources,
              "",
              model,
              Date.now() - startedAt,
              new Date(startedAt),
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
          const finalPublication = await withAnalyticsSourceAccess(
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
          if (aborter.signal.aborted) {
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
        clearTimeout(deadline);
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
        if (heartbeat) clearInterval(heartbeat);
        if (!aborter.signal.aborted) controller.error(new Error(az.analytics.answerFailed));
      });
    },
    cancel() {
      clearTimeout(deadline);
      if (heartbeat) clearInterval(heartbeat);
      aborter.abort(new Error("client disconnected"));
      void saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
      request.signal.removeEventListener("abort", abortFromRequest);
    },
  });

  return eventStream(body, requestId);
}
