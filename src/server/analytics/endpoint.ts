import { analyticsSearchRequestSchema } from "@/lib/analytics";
import type { AnalyticsSource, AnalyticsSourcePreview } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { createGeminiProviders } from "@/server/ai/gemini";
import { canPublishAnalyticsAnswer, validateCitations } from "./citations";
import { consumeAnalyticsRateLimit } from "./rate-limit";
import { searchDocumentChunks } from "./search";
import { buildAnalyticsPrompt } from "../prompts/analytics";
import { getAppConfig } from "@/server/config";

const encoder = new TextEncoder();

function jsonError(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

function eventStream(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export async function handleAnalyticsSearchRequest(request: Request): Promise<Response> {
  if (!(await consumeAnalyticsRateLimit(request))) {
    return jsonError(429, az.analytics.rateLimited);
  }

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    return jsonError(400, az.analytics.invalidRequest);
  }

  const parsed = analyticsSearchRequestSchema.safeParse(rawInput);
  if (!parsed.success) return jsonError(400, az.analytics.invalidRequest);

  const { query, filters, mode } = parsed.data;
  const startedAt = Date.now();
  let sources: AnalyticsSource[];
  let model: string;
  try {
    const providers = createGeminiProviders();
    model = providers.analytics.model;
    sources = await searchDocumentChunks(query, filters);
  } catch {
    return jsonError(500, az.analytics.searchFailed);
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
                    maxOutputTokens: 1800,
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
            if (canPublishAnalyticsAnswer(generated.text, generated.finishReason, validated)) {
              validatedAnswer = validated;
              break;
            }
          }

          if (!validatedAnswer) {
            send({ type: "error", message: az.analytics.answerFailed });
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
        } catch {
          send({ type: "error", message: az.analytics.answerFailed });
        } finally {
          close();
        }
      })().catch(() => {
        if (heartbeat) clearInterval(heartbeat);
        controller.error(new Error(az.analytics.answerFailed));
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return eventStream(body);
}
