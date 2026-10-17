export type TextGenerationInput = {
  system?: string;
  prompt: string;
  temperature?: number;
};

export interface LLMProvider {
  readonly model: string;
  generateText(input: TextGenerationInput): Promise<string>;
}

export interface EmbeddingProvider {
  readonly model: string;
  embedDocument(value: string): Promise<number[]>;
  embedDocuments(values: string[]): Promise<number[][]>;
  embedQuery(value: string): Promise<number[]>;
}
