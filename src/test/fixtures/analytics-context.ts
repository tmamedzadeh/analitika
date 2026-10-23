import type { AnalyticsSource } from "@/lib/analytics";
import type { AnalyticsContextChunk } from "@/server/analytics/context-identity";

export const contextId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export function contextFixture() {
  const text = "synthetic plant operates with production capacity steadily ".repeat(32).trim();
  const anchor: AnalyticsContextChunk = {
    id: contextId(1),
    documentId: contextId(101),
    briefId: null,
    text,
    charStart: 10000,
    charEnd: 10000 + text.length,
    ord: 1,
    sectionTitle: "Production",
    isTable: false,
    embeddingModel: "synthetic-embedding",
  };
  const prefix = "The production plant operates steadily with synthetic capacity ";
  const previous = "Independent auxiliary-only fact: 999 alien units. ".repeat(25) + prefix;
  const before: AnalyticsContextChunk = {
    ...anchor,
    id: contextId(3),
    ord: 0,
    text: previous + text.slice(0, 216),
    charStart: anchor.charStart - previous.length,
    charEnd: anchor.charStart + 216,
  };
  const suffix = " and the production plant operates steadily.";
  const next = suffix + " Independent auxiliary-only fact: 999 alien units.".repeat(25);
  const after: AnalyticsContextChunk = {
    ...anchor,
    id: contextId(4),
    ord: 2,
    text: text.slice(-216) + next,
    charStart: anchor.charEnd - 216,
    charEnd: anchor.charEnd + next.length,
  };
  const other: AnalyticsContextChunk = { ...anchor, id: contextId(2), documentId: contextId(102) };
  return {
    primary: [anchor, other],
    neighbors: [before, after],
    sources: [asSource(anchor, 1), asSource(other, 2)],
  };
}
export function asSource(chunk: AnalyticsContextChunk, n: number): AnalyticsSource {
  return {
    n,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    briefId: chunk.briefId,
    sourceKind: chunk.briefId ? "brief" : "document",
    title: "Synthetic plant",
    docDate: null,
    briefDate: null,
    direction: "OSINT",
    sectionTitle: chunk.sectionTitle,
    text: chunk.text,
    quote: chunk.text.slice(0, 100),
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    isTable: chunk.isTable,
    attachmentCount: 0,
    sourceReliability: "A",
    infoCredibility: 1,
    classification: "open",
  };
}
