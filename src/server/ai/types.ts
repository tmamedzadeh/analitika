import type { GeminiAttemptLimit, GeminiRequestBudget } from "./gemini-gateway";

export type TextGenerationInput = {
  system?: string;
  prompt: string;
  temperature?: number;
  thinkingLevel?: "low" | "medium" | "high";
  timeoutMs?: number;
  signal?: AbortSignal;
  maxAttempts?: GeminiAttemptLimit;
  requestBudget?: GeminiRequestBudget;
};

export type GroundedSearchInput = TextGenerationInput & {
  startTime?: string;
  endTime?: string;
};

export interface LLMProvider {
  readonly model: string;
  generateText(input: TextGenerationInput): Promise<string>;
  streamText(input: TextGenerationInput): Promise<AsyncIterable<string>>;
  generateGroundedSearch(input: GroundedSearchInput): Promise<{
    text: string;
    sources: Array<{ url: string; title: string }>;
  }>;
}

export interface EmbeddingProvider {
  readonly model: string;
  embedDocument(value: string, options?: { maxAttempts?: GeminiAttemptLimit }): Promise<number[]>;
  embedDocuments(
    values: string[],
    options?: { maxAttempts?: GeminiAttemptLimit },
  ): Promise<number[][]>;
  embedQuery(value: string, options?: { maxAttempts?: GeminiAttemptLimit }): Promise<number[]>;
  embedQueries(
    values: string[],
    options?: { maxAttempts?: GeminiAttemptLimit },
  ): Promise<number[][]>;
}
