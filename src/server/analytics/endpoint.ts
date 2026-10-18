import { randomUUID } from "node:crypto";

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
  const message = value.message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
  return { name: value.name, message, ...getGeminiFailureInfo(error) };
}

function answerFailureMessage(error: unknown): string {
  if (!isGeminiQuotaError(error)) return az.analytics.answerFailed;
  const quota = getGeminiFailureInfo(error).quotaKey ?? "GEMINI_CHAT_MODEL";
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
  let sources: AnalyticsSource[];
  let model: string;
  try {
    const providers = createGeminiProviders();
    model = providers.analytics.model;
    sources = await searchDocumentChunks(query, filters);
  } catch (error) {
    console.error("Analytics search failed before answer generation.", {
      requestId,
      stage: "retrieval",
      ...errorSummary(error),
    });
    return jsonError(500, az.analytics.searchFailed, requestId);
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      };
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
      };
      heartbeat = setInterval(() => {
        if (controller.desiredSize === null) {
          if (heartbeat) clearInterval(heartbeat);
          return;
        }
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
      const sourcePreviews: AnalyticsSourcePreview[] = sources.map(
        ({ text: _text, charStart: _charStart, charEnd: _charEnd, ...source }) => source,
      );
      send({ type: "sources", sources: sourcePreviews });
      void (async () => {
        if (sources.length === 0) {
          const answer = az.analytics.noSources;
          send({
            type: "final",
            answer,
            incomplete: false,
            durationMs: Date.now() - startedAt,
            model,
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
            const generated = await providers.analytics.generateTextWithMetadata(generationPrompt);
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
        } catch (error) {
          console.error("Analytics answer generation failed.", {
            requestId,
            stage: "generation",
            model,
            sourceCount: sources.length,
            durationMs: Date.now() - startedAt,
            ...errorSummary(error),
          });
          send({ type: "error", message: answerFailureMessage(error), requestId });
        } finally {
          close();
        }
      })().catch((error) => {
        console.error("Analytics answer stream failed unexpectedly.", {
          requestId,
          stage: "stream",
          ...errorSummary(error),
        });
        if (heartbeat) clearInterval(heartbeat);
        controller.error(new Error(az.analytics.answerFailed));
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return eventStream(body, requestId);
}
