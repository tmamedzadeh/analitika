import { google, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { embed, embedMany, generateText, Output, streamText as streamTextResponse } from "ai";
import { z } from "zod";

import { readServerEnv, requireServerEnv } from "../env";
import {
  withGeminiQuotaFallback,
  withGeminiQuotaFallbackStream,
  withGeminiRequest,
  withGeminiStream,
  type GeminiQuotaKey,
} from "./gemini-gateway";
import type {
  EmbeddingProvider,
  LLMProvider,
  ProviderRequestOptions,
  TextGenerationInput,
} from "./types";

function providerOptionsFor(input: TextGenerationInput, model: string) {
  const supportsThinking = /^gemini-(?:2\.5|3\.|4-)/.test(model);
  if (!input.thinkingLevel || !supportsThinking) return undefined;
  const thinkingLevel =
    input.thinkingLevel === "minimal" && model.startsWith("gemini-2.5-")
      ? "low"
      : input.thinkingLevel;
  return { google: { thinkingConfig: { thinkingLevel } } };
}

function signalFor(input: TextGenerationInput): AbortSignal | undefined {
  if (input.signal && input.timeoutMs) {
    return AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  }
  return input.signal ?? (input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined);
}

function requestOptionsFor(input: TextGenerationInput, model: string, signal = signalFor(input)) {
  const providerOptions = providerOptionsFor(input, model);
  const abortSignal = signal;
  return {
    // The gateway owns retries and Retry-After. SDK retries would multiply its budget.
    maxRetries: 0,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    ...(abortSignal === undefined ? {} : { abortSignal }),
  };
}

export class GeminiLLMProvider implements LLMProvider {
  readonly usageStats = {
    apiCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    usageReportedCalls: 0,
  };

  constructor(
    readonly model: string,
    private readonly quotaKey: GeminiQuotaKey = "AI_CHAT_MODEL",
    private readonly fallbackModel?: string,
  ) {}

  private withRequest<T>(
    input: TextGenerationInput,
    operation: (model: string, signal: AbortSignal | undefined) => Promise<T>,
    allowQuotaFallback = true,
  ): Promise<T> {
    const signal = signalFor(input);
    const run = (model: string, quotaKey: GeminiQuotaKey, maxAttempts = input.maxAttempts) =>
      withGeminiRequest(
        quotaKey,
        async () => {
          this.usageStats.apiCalls += 1;
          const result = await operation(model, signal);
          this.recordUsage(result);
          return result;
        },
        maxAttempts,
        signal,
        model,
      );
    const primary = () => run(this.model, this.quotaKey);
    const fallbackModel = this.quotaKey === "AI_CHAT_MODEL" ? this.fallbackModel : undefined;
    const operationResult = async () => {
      if (!allowQuotaFallback || !fallbackModel) return primary();
      return withGeminiQuotaFallback(this.model, fallbackModel, primary, () =>
        run(fallbackModel, "AI_LIGHT_MODEL", 1),
      );
    };
    return operationResult();
  }

  private recordUsage(value: unknown): {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
  } {
    const response = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const rawUsage =
      response["usage"] && typeof response["usage"] === "object"
        ? (response["usage"] as Record<string, unknown>)
        : {};
    const providerMetadata =
      response["providerMetadata"] && typeof response["providerMetadata"] === "object"
        ? (response["providerMetadata"] as Record<string, unknown>)
        : {};
    const googleMetadata =
      providerMetadata["google"] && typeof providerMetadata["google"] === "object"
        ? (providerMetadata["google"] as Record<string, unknown>)
        : {};
    const rawGoogleUsage =
      googleMetadata["usageMetadata"] && typeof googleMetadata["usageMetadata"] === "object"
        ? (googleMetadata["usageMetadata"] as Record<string, unknown>)
        : {};
    const numeric = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : 0;
    const inputTokens = numeric(rawUsage["inputTokens"]);
    const outputTokens = numeric(rawUsage["outputTokens"]);
    const thinkingTokens = numeric(
      rawUsage["reasoningTokens"] ?? rawGoogleUsage["thoughtsTokenCount"],
    );
    if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
      this.usageStats.inputTokens += inputTokens;
    }
    if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
      this.usageStats.outputTokens += outputTokens;
    }
    this.usageStats.thinkingTokens += thinkingTokens;
    if (typeof inputTokens === "number" || typeof outputTokens === "number") {
      this.usageStats.usageReportedCalls += 1;
    }
    return { inputTokens, outputTokens, thinkingTokens };
  }

  async generateTextWithMetadata(
    input: TextGenerationInput,
  ): Promise<{ text: string; finishReason: string; model?: string }> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    let completedModel = this.model;
    const result = await this.withRequest(input, (model, signal) => {
      completedModel = model;
      return generateText({
        model: google(model),
        ...(input.system ? { system: input.system } : {}),
        prompt: input.prompt,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
        ...requestOptionsFor(input, model, signal),
      });
    });
    return { text: result.text, finishReason: result.finishReason, model: completedModel };
  }

  async generateText(input: TextGenerationInput): Promise<string> {
    return (await this.generateTextWithMetadata(input)).text;
  }

  async generateObject<TSchema extends z.ZodType>(
    input: TextGenerationInput,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await this.withRequest(input, (model, signal) =>
      generateText({
        model: google(model),
        ...(input.system ? { system: input.system } : {}),
        prompt: input.prompt,
        output: Output.object({ schema }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
        ...requestOptionsFor(input, model, signal),
      }),
    );
    if (result.output === undefined) throw new Error("Gemini returned no structured output.");
    return result.output;
  }

  async generateObjectPrimary<TSchema extends z.ZodType>(
    input: TextGenerationInput,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await this.withRequest(
      input,
      (model, signal) =>
        generateText({
          model: google(model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          output: Output.object({ schema }),
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: input.maxOutputTokens }),
          ...requestOptionsFor(input, model, signal),
        }),
      false,
    );
    if (result.output === undefined) throw new Error("Gemini returned no structured output.");
    return result.output;
  }

  async streamText(input: TextGenerationInput): Promise<AsyncIterable<string>> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const signal = signalFor(input);
    const createStream = (
      model: string,
      quotaKey: GeminiQuotaKey,
      maxAttempts = input.maxAttempts,
    ) =>
      withGeminiStream(
        quotaKey,
        async () => {
          this.usageStats.apiCalls += 1;
          return streamTextResponse({
            model: google(model),
            ...(input.system ? { system: input.system } : {}),
            prompt: input.prompt,
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            ...(input.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: input.maxOutputTokens }),
            ...requestOptionsFor(input, model, signal),
          }).textStream;
        },
        maxAttempts,
        signal,
      );
    const primary = createStream(this.model, this.quotaKey);
    if (this.quotaKey !== "AI_CHAT_MODEL") return primary;
    const fallbackModel = this.fallbackModel;
    return withGeminiQuotaFallbackStream(
      primary,
      this.model,
      fallbackModel,
      fallbackModel ? async () => createStream(fallbackModel, "AI_LIGHT_MODEL", 1) : undefined,
    );
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly batchSize = 20;
  readonly usage = { apiCalls: 0, inputTokens: 0 };

  constructor(
    readonly model: string,
    private readonly dimensions = 768,
  ) {}

  private recordTokenUsage(value: unknown): void {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      this.usage.inputTokens += value;
    }
  }

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

  async embedDocument(value: string, request: ProviderRequestOptions = {}): Promise<number[]> {
    const result = await withGeminiRequest(
      "GEMINI_EMBED_MODEL",
      async () => {
        this.usage.apiCalls += 1;
        const result = await embed({
          maxRetries: 0,
          model: google.embedding(this.model),
          value: this.prepareValue(value, "RETRIEVAL_DOCUMENT"),
          providerOptions: this.options("RETRIEVAL_DOCUMENT"),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        });
        this.recordTokenUsage(result.usage.tokens);
        return result;
      },
      request.maxAttempts,
      request.signal,
      this.model,
    );
    return result.embedding;
  }

  async embedDocuments(
    values: string[],
    request: ProviderRequestOptions = {},
  ): Promise<number[][]> {
    if (values.length === 0) return [];
    const embeddings: number[][] = [];
    for (let offset = 0; offset < values.length; offset += this.batchSize) {
      const batch = values.slice(offset, offset + this.batchSize);
      const result = await withGeminiRequest(
        "GEMINI_EMBED_MODEL",
        async () => {
          this.usage.apiCalls += 1;
          const response = await embedMany({
            maxRetries: 0,
            model: google.embedding(this.model),
            values: batch.map((value) => this.prepareValue(value, "RETRIEVAL_DOCUMENT")),
            providerOptions: this.options("RETRIEVAL_DOCUMENT"),
            ...(request.signal ? { abortSignal: request.signal } : {}),
          });
          this.recordTokenUsage(response.usage.tokens);
          return response;
        },
        request.maxAttempts,
        request.signal,
        this.model,
      );
      embeddings.push(...result.embeddings);
    }
    return embeddings;
  }

  async embedQuery(value: string, request: ProviderRequestOptions = {}): Promise<number[]> {
    const result = await withGeminiRequest(
      "GEMINI_EMBED_MODEL",
      async () => {
        this.usage.apiCalls += 1;
        const result = await embed({
          maxRetries: 0,
          model: google.embedding(this.model),
          value: this.prepareValue(value, "RETRIEVAL_QUERY"),
          providerOptions: this.options("RETRIEVAL_QUERY"),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        });
        this.recordTokenUsage(result.usage.tokens);
        return result;
      },
      request.maxAttempts,
      request.signal,
      this.model,
    );
    return result.embedding;
  }

  async embedQueries(values: string[], request: ProviderRequestOptions = {}): Promise<number[][]> {
    if (values.length === 0) return [];
    const embeddings: number[][] = [];
    for (let offset = 0; offset < values.length; offset += this.batchSize) {
      const batch = values.slice(offset, offset + this.batchSize);
      const result = await withGeminiRequest(
        "GEMINI_EMBED_MODEL",
        async () => {
          this.usage.apiCalls += 1;
          const response = await embedMany({
            maxRetries: 0,
            model: google.embedding(this.model),
            values: batch.map((value) => this.prepareValue(value, "RETRIEVAL_QUERY")),
            providerOptions: this.options("RETRIEVAL_QUERY"),
            ...(request.signal ? { abortSignal: request.signal } : {}),
          });
          this.recordTokenUsage(response.usage.tokens);
          return response;
        },
        request.maxAttempts,
        request.signal,
        this.model,
      );
      embeddings.push(...result.embeddings);
    }
    return embeddings;
  }
}

let missingLightModelWarningLogged = false;

export function createGeminiProviders() {
  requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  const env = readServerEnv();
  const chatModel = requireServerEnv("AI_CHAT_MODEL");
  const lightModel = env.AI_LIGHT_MODEL;
  if ((!lightModel || lightModel === chatModel) && !missingLightModelWarningLogged) {
    missingLightModelWarningLogged = true;
    console.warn(
      "[AI] AI_LIGHT_MODEL is missing or matches AI_CHAT_MODEL; quota fallback is unavailable.",
    );
  }
  return {
    analytics: new GeminiLLMProvider(chatModel, "AI_CHAT_MODEL", lightModel),
    light: lightModel
      ? new GeminiLLMProvider(lightModel, "AI_LIGHT_MODEL")
      : new GeminiLLMProvider(chatModel, "AI_CHAT_MODEL"),
    embeddings: new GeminiEmbeddingProvider(requireServerEnv("GEMINI_EMBED_MODEL"), 768),
  };
}
