import { analyticsSearchRequestSchema } from "@/lib/analytics";
import type { AnalyticsSource, AnalyticsSourcePreview } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";
import { createGeminiProviders } from "@/server/ai/gemini";
import { validateCitations } from "./citations";
import { consumeAnalyticsRateLimit, getAnalyticsClientKey } from "./rate-limit";
import { searchDocumentChunks } from "./search";
import { buildAnalyticsPrompt } from "../prompts/analytics";

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
  if (!consumeAnalyticsRateLimit(getAnalyticsClientKey(request))) {
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

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
      };
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
          controller.close();
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
          controller.close();
          return;
        }

        let generated = "";
        try {
          const providers = createGeminiProviders();
          const prompt = buildAnalyticsPrompt(query, sources);
          const chunks = await providers.analytics.streamText(prompt);
          for await (const part of chunks) {
            generated += part;
            send({ type: "delta", text: part });
          }

          const validated = validateCitations(generated, sources, prompt.lowReliabilityWarning);
          send({
            type: "final",
            answer: validated.answer,
            incomplete: validated.incomplete,
            durationMs: Date.now() - startedAt,
            model,
          });
        } catch {
          send({ type: "error", message: az.analytics.answerFailed });
        } finally {
          controller.close();
        }
      })().catch(() => {
        controller.error(new Error(az.analytics.answerFailed));
      });
    },
  });

  return eventStream(body);
}
