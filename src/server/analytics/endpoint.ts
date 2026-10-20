import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/server/auth";

import { analyticsSearchRequestSchema } from "@/lib/analytics";
import type { AnalyticsSource, AnalyticsSourcePreview } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { createGeminiProviders } from "@/server/ai/gemini";
import { getGeminiFailureInfo, isGeminiQuotaError } from "@/server/ai/gemini-gateway";
import { canPublishAnalyticsAnswer, validateCitations } from "./citations";
import { consumeAnalyticsRateLimit } from "./rate-limit";
import { searchDocumentChunks } from "./search";
import { buildAnalyticsPrompt } from "../prompts/analytics";
import { getAppConfig } from "@/server/config";
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

function errorSummary(error: unknown) {
  const value = error instanceof Error ? error : new Error(String(error));
  const failure = getGeminiFailureInfo(error);
  return {
    name: value.name,
    statusCode: failure.statusCode,
    quotaKey: failure.quotaKey,
  };
}

function answerFailureMessage(error: unknown): string {
  if (!isGeminiQuotaError(error)) return az.analytics.answerFailed;
  const quota = getGeminiFailureInfo(error).quotaKey ?? "AI_CHAT_MODEL";
  return az.analytics.quotaExceeded.replace("{quota}", quota);
}

export async function handleAnalyticsSearchRequest(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-vercel-id") || randomUUID();
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
  const startedAt = Date.now();
  const historyId = randomUUID();
  const user = getCurrentUser();
  try {
    await createAnalyticsHistoryRecord({ id: historyId, createdBy: user.id, query, filters });
  } catch {
    // History persistence is best-effort and must not block a live response.
  }
  const aborter = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const saveHistory = async (input: Parameters<typeof updateAnalyticsHistoryRecord>[1]) => {
    try {
      await updateAnalyticsHistoryRecord(historyId, input);
    } catch {
      // History persistence is best-effort and must not block a live response.
    }
  };
  const abortFromRequest = () => {
    aborter.abort(request.signal.reason);
    if (heartbeat) clearInterval(heartbeat);
    void saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
  };
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });
  let sources: AnalyticsSource[];
  let model: string;
  try {
    const providers = createGeminiProviders();
    model = providers.analytics.model;
    sources = await searchDocumentChunks(query, filters, { signal: aborter.signal });
  } catch (error) {
    if (aborter.signal.aborted) {
      await saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
      request.signal.removeEventListener("abort", abortFromRequest);
      return new Response(null, { status: 499, headers: { "x-analytics-request-id": requestId } });
    }
    console.error("Analytics search failed before answer generation.", {
      requestId,
      stage: "retrieval",
      ...errorSummary(error),
    });
    await saveHistory({ status: "failed", durationMs: Date.now() - startedAt });
    return jsonError(500, az.analytics.searchFailed, requestId);
  }
  if (aborter.signal.aborted) {
    await saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
    request.signal.removeEventListener("abort", abortFromRequest);
    return new Response(null, { status: 499, headers: { "x-analytics-request-id": requestId } });
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", abortFromRequest);
        try {
          controller.close();
        } catch {
          /* Stream was cancelled by the client. */
        }
      };
      const send = (event: Record<string, unknown>) => {
        if (closed || aborter.signal.aborted || controller.desiredSize === null) return false;
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
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
      const sourcePreviews: AnalyticsSourcePreview[] = sources.map(
        ({ text: _text, charStart: _charStart, charEnd: _charEnd, ...source }) => source,
      );
      send({ type: "sources", sources: sourcePreviews });
      void (async () => {
        if (aborter.signal.aborted) {
          await saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
          close();
          return;
        }
        if (sources.length === 0) {
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
          send({
            type: "final",
            answer: "",
            incomplete: false,
            durationMs: Date.now() - startedAt,
            model,
          });
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
          const providers = createGeminiProviders();
          const prompt = buildAnalyticsPrompt(
            query,
            sources,
            getAppConfig().analyticsThinkingLevel,
          );
          let validatedAnswer: ReturnType<typeof validateCitations> | null = null;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const generationPrompt =
              attempt === 0
                ? prompt
                : {
                    ...prompt,
                    maxOutputTokens: 6144,
                    system:
                      prompt.system +
                      "\nƏvvəlki cavab tam və düzgün istinadlarla bitmədi. Tam cavab yaz, hər istinadı bağla və fikri yarımçıq saxlamadan yekunlaşdır.",
                    prompt:
                      prompt.prompt +
                      "\n\nXüsusi tələb: Cavabın sonunda açıq mötərizə və ya yarımçıq istinad qoyma; bütün istinadları mənbələr siyahısı ilə yoxla.",
                  };
            const generated = await providers.analytics.generateTextWithMetadata({
              ...generationPrompt,
              signal: aborter.signal,
            });
            const validated = validateCitations(
              generated.text,
              sources,
              prompt.lowReliabilityWarning,
            );
            const publishable = canPublishAnalyticsAnswer(
              generated.text,
              generated.finishReason,
              validated,
            );
            if (publishable) {
              validatedAnswer = validated;
              break;
            }
            console.warn("Analytics answer rejected by completeness validation.", {
              requestId,
              stage: "answer_validation",
              model,
              sourceCount: sources.length,
              attempt: attempt + 1,
              finishReason: generated.finishReason,
              outputCharacters: generated.text.length,
              citationCount: [...generated.text.matchAll(/\[\d+\]/g)].length,
              invalidCitation: validated.incomplete,
              openCitation: /\[\s*\d*\s*$/.test(generated.text.trim()),
            });
          }

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

          send({
            type: "final",
            answer: validatedAnswer.answer,
            incomplete: false,
            durationMs: Date.now() - startedAt,
            model,
          });
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
            await saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
          } else {
            console.error("Analytics answer generation failed.", {
              requestId,
              stage: "generation",
              model,
              sourceCount: sources.length,
              durationMs: Date.now() - startedAt,
              ...errorSummary(error),
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
            send({ type: "error", message: answerFailureMessage(error), requestId });
          }
        } finally {
          close();
        }
      })().catch((error) => {
        if (!aborter.signal.aborted)
          console.error("Analytics answer stream failed unexpectedly.", {
            requestId,
            stage: "stream",
            ...errorSummary(error),
          });
        if (heartbeat) clearInterval(heartbeat);
        if (!aborter.signal.aborted) controller.error(new Error(az.analytics.answerFailed));
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      aborter.abort(new Error("client disconnected"));
      void saveHistory({ status: "cancelled", durationMs: Date.now() - startedAt });
      request.signal.removeEventListener("abort", abortFromRequest);
    },
  });

  return eventStream(body, requestId);
}
