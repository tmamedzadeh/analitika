import { describe, expect, it } from "vitest";

import { formatBriefEmbeddingText } from "@/lib/briefs";
import { chunkDocument } from "./chunker";

describe("daily brief chunking", () => {
  it("uses the document chunker for headings and tables with source offsets", () => {
    const body = "# Nəticə\nDəhliz üzrə daşınma artıb.\n\n| İl | Yük |\n|---|---:|\n|2025|12|";
    const chunks = chunkDocument(body, "Brif", { targetChars: 300 });
    expect(chunks.some((chunk) => chunk.isTable)).toBe(true);
    expect(
      chunks
        .filter((chunk) => !chunk.isTable)
        .every((chunk) => body.slice(chunk.charStart, chunk.charEnd) === chunk.text),
    ).toBe(true);
    expect(formatBriefEmbeddingText("Brif", "2026-10-18", chunks[0]!.text)).toContain(
      "Brif / 2026-10-18\n",
    );
  });
});
