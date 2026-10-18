import type { LLMProvider, SearchInput, SearchProvider, SearchSource } from "./types";

export class GeminiGroundingProvider implements SearchProvider {
  readonly provider = "gemini_grounding" as const;
  readonly model: string;

  constructor(private readonly llm: LLMProvider) {
    this.model = llm.model;
  }

  async search(input: SearchInput): Promise<SearchSource[]> {
    if (!this.llm.generateGroundedSearch) {
      throw new Error("Gemini grounding is not available on the configured model.");
    }
    const periodText = input.startPublishedDate
      ? "Publication date range: " +
        input.startPublishedDate +
        " through " +
        (input.endPublishedDate ?? "now") +
        "."
      : "Search without a publication date restriction.";
    input.requestBudget?.reserve();
    const result = await this.llm.generateGroundedSearch({
      prompt: [
        "Use Google Search to find up to " +
          input.limit +
          " relevant public pages written in language " +
          input.language +
          ".",
        "Query: " + input.query,
        periodText,
        "Return concise evidence-based findings and use the web search tool.",
      ].join("\n\n"),
      temperature: 0.1,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.startPublishedDate && input.endPublishedDate
        ? { startTime: input.startPublishedDate, endTime: input.endPublishedDate }
        : {}),
      ...(input.llmRequestBudget ? { requestBudget: input.llmRequestBudget } : {}),
    });
    return result.sources.slice(0, input.limit).map((source, index) => ({
      url: source.url,
      title: source.title,
      index: source.index ?? index + 1,
      ...(index === 0 && result.text.trim() ? { searchSummary: result.text.trim() } : {}),
    }));
  }
}
