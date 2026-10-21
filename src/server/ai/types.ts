import type { GeminiAttemptLimit } from "./gemini-gateway";
import type { z } from "zod";

export type ProviderRequestOptions = {
  maxAttempts?: GeminiAttemptLimit;
  signal?: AbortSignal;
};

export type ProviderUsageStats = {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  usageReportedCalls?: number;
};

export type TextGenerationInput = {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
  signal?: AbortSignal;
  maxAttempts?: GeminiAttemptLimit;
};

export interface LLMProvider {
  readonly model: string;
  readonly usageStats?: Readonly<ProviderUsageStats>;
  generateText(input: TextGenerationInput): Promise<string>;
  generateObject?<TSchema extends z.ZodType>(
    input: TextGenerationInput,
    schema: TSchema,
  ): Promise<z.output<TSchema>>;
  generateObjectPrimary?<TSchema extends z.ZodType>(
    input: TextGenerationInput,
    schema: TSchema,
  ): Promise<z.output<TSchema>>;
  streamText(input: TextGenerationInput): Promise<AsyncIterable<string>>;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly processingBoundary?: "local" | "external";
  readonly usageStats?: Readonly<ProviderUsageStats>;
  embedDocument(value: string, options?: ProviderRequestOptions): Promise<number[]>;
  embedDocuments(values: string[], options?: ProviderRequestOptions): Promise<number[][]>;
  embedQuery(value: string, options?: ProviderRequestOptions): Promise<number[]>;
  embedQueries(values: string[], options?: ProviderRequestOptions): Promise<number[][]>;
}
