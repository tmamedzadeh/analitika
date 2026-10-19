import type { GeminiAttemptLimit, GeminiRequestBudget } from "./gemini-gateway";
import type { z } from "zod";

export type ProviderRequestOptions = {
  maxAttempts?: GeminiAttemptLimit;
  requestBudget?: GeminiRequestBudget;
};

export type ProviderUsageStats = {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
  usageReportedCalls?: number;
};

export interface RequestCallBudget {
  readonly calls: number;
  reserve(): void;
}

export type SearchInput = {
  query: string;
  language: string;
  limit?: number;
  numResults?: number;
  startPublishedDate?: string;
  endPublishedDate?: string;
  country?: string;
  userLocation?: string;
  includeDomains?: string[];
  period?: "24h" | "7d" | "30d" | "all";
  timeoutMs?: number;
  signal?: AbortSignal;
  requestBudget?: RequestCallBudget;
  llmRequestBudget?: GeminiRequestBudget;
};

export type SearchSource = {
  url: string;
  title: string;
  publishedDate?: string;
  publishedAt?: string;
  snippet?: string;
  text?: string;
  highlights?: string[];
  searchSummary?: string;
  index: number;
  providerRank?: number;
  rrfScore?: number;
  provider?: SearchProviderId;
  providers?: SearchProviderId[];
};

export type SearchProviderId = "exa" | "tavily" | "hasdata" | "gemini_grounding";

export type SearchProviderCapabilities = {
  hasText: boolean;
  supportsDomains: boolean;
  supportsCountry: boolean;
  supportsLanguage: boolean;
  supportsDateRange: boolean;
};

export interface SearchProvider {
  readonly provider: SearchProviderId;
  readonly capabilities?: SearchProviderCapabilities;
  readonly usageStats?: Readonly<{ apiCalls: number; credits?: number }>;
  search(input: SearchInput): Promise<SearchSource[]>;
}

export type TextGenerationInput = {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
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

export type GroundedWebSource = {
  url: string;
  title: string;
  index?: number;
};

export interface LLMProvider {
  readonly model: string;
  readonly usageStats?: Readonly<ProviderUsageStats>;
  generateText(input: TextGenerationInput): Promise<string>;
  generateObject?<TSchema extends z.ZodType>(
    input: TextGenerationInput,
    schema: TSchema,
  ): Promise<z.output<TSchema>>;
  streamText(input: TextGenerationInput): Promise<AsyncIterable<string>>;
  generateGroundedSearch?(input: GroundedSearchInput): Promise<{
    text: string;
    sources: GroundedWebSource[];
  }>;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly usageStats?: Readonly<ProviderUsageStats>;
  embedDocument(value: string, options?: ProviderRequestOptions): Promise<number[]>;
  embedDocuments(values: string[], options?: ProviderRequestOptions): Promise<number[][]>;
  embedQuery(value: string, options?: ProviderRequestOptions): Promise<number[]>;
  embedQueries(values: string[], options?: ProviderRequestOptions): Promise<number[][]>;
}
