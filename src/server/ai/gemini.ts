import { google, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { embed, embedMany, generateText, Output, streamText as streamTextResponse } from "ai";
import { z } from "zod";

import { requireServerEnv } from "../env";
import { withGeminiRequest, withGeminiStream, type GeminiQuotaKey } from "./gemini-gateway";
import type {
  EmbeddingProvider,
  GroundedSearchInput,
  LLMProvider,
  ProviderRequestOptions,
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
  readonly usageStats = { apiCalls: 0, inputTokens: 0, outputTokens: 0, usageReportedCalls: 0 };

  constructor(
    readonly model: string,
    private readonly quotaKey: GeminiQuotaKey = "GEMINI_CHAT_MODEL",
  ) {}

  private recordUsage(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const usage = value as { inputTokens?: unknown; outputTokens?: unknown };
    const inputTokens = usage.inputTokens;
    const outputTokens = usage.outputTokens;
    if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
      this.usageStats.inputTokens += inputTokens;
    }
    if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
      this.usageStats.outputTokens += outputTokens;
    }
    if (typeof inputTokens === "number" || typeof outputTokens === "number") {
      this.usageStats.usageReportedCalls += 1;
    }
  }

  async generateText(input: TextGenerationInput): Promise<string> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await withGeminiRequest(
      this.quotaKey,
      async () => {
        this.usageStats.apiCalls += 1;
        const response = await generateText({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        });
        this.recordUsage(response.usage);
        return response;
      },
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
      async () => {
        this.usageStats.apiCalls += 1;
        const response = await generateText({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          output: Output.object({ schema }),
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        });
        this.recordUsage(response.usage);
        return response;
      },
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
      async () => (
        this.usageStats.apiCalls++,
        streamTextResponse({
          model: google(this.model),
          ...(input.system ? { system: input.system } : {}),
          prompt: input.prompt,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...requestOptionsFor(input, this.model),
        }).textStream
      ),
      input.requestBudget,
      input.maxAttempts,
    );
  }

  async generateGroundedSearch(input: GroundedSearchInput) {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await withGeminiRequest(
      this.quotaKey,
      async () => {
        this.usageStats.apiCalls += 1;
        const response = await generateText({
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
        });
        this.recordUsage(response.usage);
        return response;
      },
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
    const metadataSources = (providerMetadata?.groundingMetadata?.groundingChunks ?? []).flatMap(
      (chunk) =>
        chunk.web?.uri
          ? [{ url: chunk.web.uri, title: chunk.web.title?.trim() || chunk.web.uri }]
          : [],
    );
    const sources = metadataSources.length
      ? metadataSources
      : result.sources.flatMap((source) =>
          source.sourceType === "url"
            ? [{ url: source.url, title: source.title?.trim() || source.url }]
            : [],
        );
    return { text: result.text, sources };
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
          model: google.embedding(this.model),
          value: this.prepareValue(value, "RETRIEVAL_DOCUMENT"),
          providerOptions: this.options("RETRIEVAL_DOCUMENT"),
        });
        this.recordTokenUsage(result.usage.tokens);
        return result;
      },
      request.requestBudget,
      request.maxAttempts,
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
            model: google.embedding(this.model),
            values: batch.map((value) => this.prepareValue(value, "RETRIEVAL_DOCUMENT")),
            providerOptions: this.options("RETRIEVAL_DOCUMENT"),
          });
          this.recordTokenUsage(response.usage.tokens);
          return response;
        },
        request.requestBudget,
        request.maxAttempts,
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
          model: google.embedding(this.model),
          value: this.prepareValue(value, "RETRIEVAL_QUERY"),
          providerOptions: this.options("RETRIEVAL_QUERY"),
        });
        this.recordTokenUsage(result.usage.tokens);
        return result;
      },
      request.requestBudget,
      request.maxAttempts,
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
            model: google.embedding(this.model),
            values: batch.map((value) => this.prepareValue(value, "RETRIEVAL_QUERY")),
            providerOptions: this.options("RETRIEVAL_QUERY"),
          });
          this.recordTokenUsage(response.usage.tokens);
          return response;
        },
        request.requestBudget,
        request.maxAttempts,
      );
      embeddings.push(...result.embeddings);
    }
    return embeddings;
  }
}

export function createGeminiProviders() {
  requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  return {
    analytics: new GeminiLLMProvider(requireServerEnv("GEMINI_CHAT_MODEL"), "GEMINI_CHAT_MODEL"),
    osint: new GeminiLLMProvider(requireServerEnv("GEMINI_CHAT_MODEL"), "GEMINI_CHAT_MODEL"),
    light: new GeminiLLMProvider(requireServerEnv("GEMINI_LIGHT_MODEL"), "GEMINI_LIGHT_MODEL"),
    embeddings: new GeminiEmbeddingProvider(requireServerEnv("GEMINI_EMBED_MODEL"), 768),
  };
}
