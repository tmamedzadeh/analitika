import { describe, expect, it } from "vitest";

import { chunkDocument } from "./chunker";

describe("chunkDocument", () => {
  it("splits sections and stores clean text with source offsets", () => {
    const body = "# Başlanğıc\nBirinci abzas.\n\n## Nəticə\nİkinci abzas.";
    const chunks = chunkDocument(body, "Hesabat");

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      sectionTitle: "Başlanğıc",
      text: "Birinci abzas.",
      isTable: false,
    });
    expect(chunks[1]).toMatchObject({
      sectionTitle: "Nəticə",
      text: "İkinci abzas.",
      isTable: false,
    });
    expect(body.slice(chunks[0]!.charStart, chunks[0]!.charEnd)).toBe(chunks[0]!.text);
    expect(chunks[1]!.embeddingText).toContain("Hesabat / Nəticə");
  });

  it("packs nearby paragraphs within the same section into one chunk", () => {
    const body = "## Bölmə\nBirinci qısa abzas.\n\nİkinci qısa abzas.";
    const chunks = chunkDocument(body, "Hesabat");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("Birinci qısa abzas.\n\nİkinci qısa abzas.");
    expect(body.slice(chunks[0]!.charStart, chunks[0]!.charEnd)).toBe(chunks[0]!.text);
  });

  it("keeps markdown tables separate and repeats the header when splitting", () => {
    const body = [
      "# Cədvəl",
      "| Ad | Dəyər |",
      "| --- | --- |",
      ...Array.from(
        { length: 10 },
        (_, index) => `| Ad${index} | ${"uzun dəyər ".repeat(3)}${index} |`,
      ),
    ].join("\n");
    const chunks = chunkDocument(body, "Qeyd", { targetChars: 128, overlapChars: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.isTable)).toBe(true);
    expect(chunks.every((chunk) => chunk.text.includes("| Ad | Dəyər |"))).toBe(true);
    expect(chunks.every((chunk) => chunk.sectionTitle === "Cədvəl")).toBe(true);
  });

  it("splits long prose into overlapping ranges", () => {
    const body = Array.from({ length: 90 }, (_, index) => `söz${index}`).join(" ");
    const chunks = chunkDocument(body, "Uzun", { targetChars: 160, overlapChars: 24 });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.charEnd).toBeGreaterThan(chunks[1]!.charStart);
    expect(chunks.every((chunk) => body.slice(chunk.charStart, chunk.charEnd) === chunk.text)).toBe(
      true,
    );
  });
});
