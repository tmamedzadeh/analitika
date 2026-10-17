import { google, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { embed, embedMany, generateText, Output, streamText as streamTextResponse } from "ai";
import { z } from "zod";

import { getAppConfig } from "../config";
import { requireServerEnv } from "../env";
import { withGeminiRequest, withGeminiStream, type GeminiQuotaKey } from "./gemini-gateway";
import type {
  EmbeddingProvider,
  GroundedSearchInput,
  LLMProvider,
  TextGenerationInput,
} from "./types";

function providerOptionsFor(input: TextGenerationInput, model: string) {
  const isGemini3Or4 = model.startsWith("gemini-3.") || model.startsWith("gemini-4-");
  if (!input.thinkingLevel || !isGemini3Or4) return undefined;
  return { google: { thinkingConfig: { thinkingLevel: input.thinkingLevel } } };
}

function signalFor(input: TextGenerationInput): AbortSignal | undefined {
  if (input.signal && input.timeoutMs) {
    return AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  }
  return input.signal ?? (input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined);
}

function requestOptionsFor(input: TextGenerationInput, model: string) {
  const providerOptions = providerOptionsFor(input, model);
  const abortSignal = signalFor(input);
  return {
    ...(providerOptions === undefined ? {} : { providerOptions }),
    ...(abortSignal === undefined ? {} : { abortSignal }),
  };
}

export class GeminiLLMProvider implements LLMProvider {
  constructor(
    readonly model: string,
    private readonly quotaKey: GeminiQuotaKey = "GEMINI_CHAT_MODEL",
  ) {}

  async generateText(input: TextGenerationInput): Promise<string> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await withGeminiRequest(
      this.quotaKey,
      () =>
        generateText({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        }),
      input.requestBudget,
      input.maxAttempts,
    );
    return result.text;
  }

  async generateObject<TSchema extends z.ZodType>(
    input: TextGenerationInput,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await withGeminiRequest(
      this.quotaKey,
      () =>
        generateText({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          output: Output.object({ schema }),
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        }),
      input.requestBudget,
      input.maxAttempts,
    );
    if (result.output === undefined) throw new Error("Gemini returned no structured output.");
    return result.output;
  }

  async streamText(input: TextGenerationInput): Promise<AsyncIterable<string>> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    return withGeminiStream(
      this.quotaKey,
      async () =>
        streamTextResponse({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        }).textStream,
      input.requestBudget,
      input.maxAttempts,
    );
  }

  async generateGroundedSearch(input: GroundedSearchInput) {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await withGeminiRequest(
      this.quotaKey,
      () =>
        generateText({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          tools: {
            google_search: google.tools.googleSearch({
              ...(input.startTime && input.endTime
                ? { timeRangeFilter: { startTime: input.startTime, endTime: input.endTime } }
                : {}),
            }) as never,
          },
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        }),
      input.requestBudget,
      input.maxAttempts,
    );
    const providerMetadata = result.providerMetadata?.["google"] as
      | {
          groundingMetadata?: {
            groundingChunks?: Array<{
              web?: { uri?: string; title?: string | null } | null;
            }> | null;
          } | null;
        }
      | undefined;
    const sources = (providerMetadata?.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) =>
      chunk.web?.uri
        ? [{ url: chunk.web.uri, title: chunk.web.title?.trim() || chunk.web.uri }]
        : [],
    );
    return { text: result.text, sources };
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    readonly model: string,
    private readonly dimensions = 768,
  ) {}

  private prepareValue(value: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): string {
    if (this.model !== "gemini-embedding-2") return value;
    if (taskType === "RETRIEVAL_QUERY") return "task: search query | query: " + value;
    return "task: search document | text: " + value;
  }

  private options(taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
    return {
      google: {
        outputDimensionality: this.dimensions,
        ...(this.model === "gemini-embedding-001" ? { taskType } : {}),
      } satisfies GoogleEmbeddingModelOptions,
    };
  }

  async embedDocument(value: string, request: { maxAttempts?: 1 | 2 | 3 } = {}): Promise<number[]> {
    const result = await withGeminiRequest(
      "GEMINI_EMBED_MODEL",
      () =>
        embed({
          model: google.embedding(this.model),
          value: this.prepareValue(value, "RETRIEVAL_DOCUMENT"),
          providerOptions: this.options("RETRIEVAL_DOCUMENT"),
        }),
      undefined,
      request.maxAttempts,
    );
    return result.embedding;
  }

  async embedDocuments(
    values: string[],
    request: { maxAttempts?: 1 | 2 | 3 } = {},
  ): Promise<number[][]> {
    if (values.length === 0) return [];
    const result = await withGeminiRequest(
      "GEMINI_EMBED_MODEL",
      () =>
        embedMany({
          model: google.embedding(this.model),
          values: values.map((value) => this.prepareValue(value, "RETRIEVAL_DOCUMENT")),
          providerOptions: this.options("RETRIEVAL_DOCUMENT"),
        }),
      undefined,
      request.maxAttempts,
    );
    return result.embeddings;
  }

  async embedQuery(value: string, request: { maxAttempts?: 1 | 2 | 3 } = {}): Promise<number[]> {
    const result = await withGeminiRequest(
      "GEMINI_EMBED_MODEL",
      () =>
        embed({
          model: google.embedding(this.model),
          value: this.prepareValue(value, "RETRIEVAL_QUERY"),
          providerOptions: this.options("RETRIEVAL_QUERY"),
        }),
      undefined,
      request.maxAttempts,
    );
    return result.embedding;
  }

  async embedQueries(
    values: string[],
    request: { maxAttempts?: 1 | 2 | 3 } = {},
  ): Promise<number[][]> {
    if (values.length === 0) return [];
    const result = await withGeminiRequest(
      "GEMINI_EMBED_MODEL",
      () =>
        embedMany({
          model: google.embedding(this.model),
          values: values.map((value) => this.prepareValue(value, "RETRIEVAL_QUERY")),
          providerOptions: this.options("RETRIEVAL_QUERY"),
        }),
      undefined,
      request.maxAttempts,
    );
    return result.embeddings;
  }
}

export function createGeminiProviders() {
  requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  const config = getAppConfig();
  return {
    analytics: new GeminiLLMProvider(config.analyticsModel, "GEMINI_CHAT_MODEL"),
    osint: new GeminiLLMProvider(config.osintModel, "GEMINI_CHAT_MODEL"),
    light: new GeminiLLMProvider(config.lightModel, "GEMINI_LIGHT_MODEL"),
    embeddings: new GeminiEmbeddingProvider(config.embeddingModel, config.embeddingDimensions),
  };
}
