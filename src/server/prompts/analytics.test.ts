import { describe, expect, it } from "vitest";
import type { AnalyticsSource } from "@/lib/analytics";
import { buildAnalyticsPrompt } from "./analytics";

describe("standard RAG analytics prompt", () => {
  it("requests an Azerbaijani answer with source numbers without evidence markers or fixed length", () => {
    const source: AnalyticsSource = {
      n: 1,
      sourceKind: "document",
      documentId: "doc",
      briefId: null,
      chunkId: "chunk",
      title: "Synthetic title",
      sectionTitle: "Section",
      text: "Synthetic document text.",
      quote: "Synthetic document text.",
      charStart: 0,
      charEnd: 24,
      docDate: null,
      briefDate: null,
      direction: "OSINT",
      isTable: false,
      attachmentCount: 0,
      sourceReliability: "A",
      infoCredibility: 1,
      classification: "open",
    };
    const prompt = buildAnalyticsPrompt("Synthetic question", [source], "low");
    expect(prompt.system).toContain("Azərbaycan dilində");
    expect(prompt.system).toContain("[1], [2]");
    expect(prompt.system).toContain("Fakt, tarix və rəqəm uydurma");
    expect(prompt.system).toContain("etibarsız məlumatdır");
    expect(prompt.system).not.toMatch(/⟦|⟧|sözbəsöz|150|400|2–3|4–8|Hər faktiki cümlə/u);
    expect(prompt.prompt).toContain(source.text);
    expect(prompt.prompt).toContain("Synthetic question");
    expect(prompt.thinkingLevel).toBe("low");
  });
});
