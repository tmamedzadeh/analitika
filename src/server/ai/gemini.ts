import { google, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { embed, embedMany, generateText } from "ai";

import { getAppConfig } from "../config";
import { requireServerEnv } from "../env";
import type { EmbeddingProvider, LLMProvider, TextGenerationInput } from "./types";

export class GeminiLLMProvider implements LLMProvider {
  constructor(readonly model: string) {}

  async generateText(input: TextGenerationInput): Promise<string> {
    requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    const result = await generateText({
      model: google(this.model),
      ...(input.system ? { system: input.system } : {}),
      prompt: input.prompt,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    });
    return result.text;
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

  async embedDocument(value: string): Promise<number[]> {
    const result = await embed({
      model: google.embedding(this.model),
      value: this.prepareValue(value, "RETRIEVAL_DOCUMENT"),
      providerOptions: this.options("RETRIEVAL_DOCUMENT"),
    });
    return result.embedding;
  }

  async embedDocuments(values: string[]): Promise<number[][]> {
    if (values.length === 0) return [];
    const result = await embedMany({
      model: google.embedding(this.model),
      values: values.map((value) => this.prepareValue(value, "RETRIEVAL_DOCUMENT")),
      providerOptions: this.options("RETRIEVAL_DOCUMENT"),
    });
    return result.embeddings;
  }

  async embedQuery(value: string): Promise<number[]> {
    const result = await embed({
      model: google.embedding(this.model),
      value: this.prepareValue(value, "RETRIEVAL_QUERY"),
      providerOptions: this.options("RETRIEVAL_QUERY"),
    });
    return result.embedding;
  }
}

export function createGeminiProviders() {
  requireServerEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  const config = getAppConfig();
  return {
    analytics: new GeminiLLMProvider(config.analyticsModel),
    osint: new GeminiLLMProvider(config.osintModel),
    light: new GeminiLLMProvider(config.lightModel),
    embeddings: new GeminiEmbeddingProvider(config.embeddingModel, config.embeddingDimensions),
  };
}
