export type TextGenerationInput = {
  system?: string;
  prompt: string;
  temperature?: number;
  thinkingLevel?: "low" | "medium" | "high";
};

export interface LLMProvider {
  readonly model: string;
  generateText(input: TextGenerationInput): Promise<string>;
  streamText(input: TextGenerationInput): Promise<AsyncIterable<string>>;
}

export interface EmbeddingProvider {
  readonly model: string;
  embedDocument(value: string): Promise<number[]>;
  embedDocuments(values: string[]): Promise<number[][]>;
  embedQuery(value: string): Promise<number[]>;
}
