import type { GeminiAttemptLimit, GeminiRequestBudget } from "./gemini-gateway";

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
  limit: number;
  startPublishedDate?: string;
  endPublishedDate?: string;
  userLocation?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  requestBudget?: RequestCallBudget;
  llmRequestBudget?: GeminiRequestBudget;
};

export type SearchSource = {
  url: string;
  title: string;
  publishedDate?: string;
  text?: string;
  highlights?: string[];
  searchSummary?: string;
  index: number;
};

export interface SearchProvider {
  readonly provider: "exa" | "gemini_grounding";
  search(input: SearchInput): Promise<SearchSource[]>;
}

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

export type GroundedWebSource = {
  url: string;
  title: string;
  index?: number;
};

export interface LLMProvider {
  readonly model: string;
  readonly usageStats?: Readonly<ProviderUsageStats>;
  generateText(input: TextGenerationInput): Promise<string>;
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
