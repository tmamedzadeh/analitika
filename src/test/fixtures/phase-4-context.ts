import { asSource, contextId } from "./analytics-context";
import type { AnalyticsContextChunk } from "@/server/analytics/context-identity";
import { chunkDocument } from "@/server/ingest/chunker";

function boundaryFixture(selfContained = false, newFact = false) {
  const base = "zavod texniki xidmət və istehsal imkanlarını mərhələli şəkildə inkişaf etdirir "
    .repeat(25)
    .trim();
  const text = selfContained ? "Z" + base.slice(1) + "." : base;
  const anchor: AnalyticsContextChunk = {
    id: contextId(401),
    documentId: contextId(501),
    briefId: null,
    text,
    ord: 1,
    charStart: 10000,
    charEnd: 10000 + text.length,
    sectionTitle: "Texniki xidmət",
    isTable: false,
    embeddingModel: "synthetic-embedding",
  };
  const prefix = newFact
    ? "Yeni zavod gündə 999 məhsul istehsal edir və "
    : "Bu texniki xidmət imkanlarını zavod mərhələli şəkildə inkişaf etdirir və ";
  const previous = "Yalnız qonşuda olan ayrıca fakt: 777 yeni qurğu. ".repeat(20) + prefix;
  const next =
    (newFact
      ? " və gündə 999 yeni məhsul buraxır."
      : " və zavod istehsal imkanlarını inkişaf etdirir.") +
    " Yalnız qonşuda olan ayrıca fakt: 777 yeni qurğu.".repeat(20);
  const neighbors: AnalyticsContextChunk[] = [
    {
      ...anchor,
      id: contextId(403),
      ord: 0,
      text: previous + text.slice(0, 216),
      charStart: anchor.charStart - previous.length,
      charEnd: anchor.charStart + 216,
    },
    {
      ...anchor,
      id: contextId(404),
      ord: 2,
      text: text.slice(-216) + next,
      charStart: anchor.charEnd - 216,
      charEnd: anchor.charEnd + next.length,
    },
  ];
  const primary = [anchor, { ...anchor, id: contextId(402), documentId: contextId(502) }];
  return { primary, sources: primary.map((chunk, index) => asSource(chunk, index + 1)), neighbors };
}

export function phase4ContextCases() {
  const useful = boundaryFixture();
  const section = boundaryFixture();
  section.neighbors = section.neighbors.map((chunk) => ({ ...chunk, sectionTitle: "Başqa bölmə" }));
  const version = boundaryFixture();
  version.neighbors = version.neighbors.map((chunk) => ({ ...chunk, embeddingModel: "old-model" }));
  const absent = boundaryFixture();
  absent.neighbors = [];
  return [
    {
      id: "boundary_interpretation",
      description: "Controlled cut sentence with familiar vocabulary in a new boundary order",
      expected: 2,
      ...useful,
    },
    {
      id: "self_contained",
      description: "Complete uppercase-start, terminal-period evidence",
      expected: 0,
      ...boundaryFixture(true),
    },
    {
      id: "auxiliary_new_fact",
      description: "New quantity and factual vocabulary appear only in neighbors",
      expected: 0,
      ...boundaryFixture(false, true),
    },
    {
      id: "different_section",
      description: "Adjacent ord belongs to another section",
      expected: 0,
      ...section,
    },
    {
      id: "different_model",
      description: "Adjacent ord has an incompatible embedding generation",
      expected: 0,
      ...version,
    },
    {
      id: "no_neighbor",
      description: "No available neighbor returned from the authorized read",
      expected: 0,
      ...absent,
    },
  ];
}

/** A separate, ordinary prose example exercises the real unchanged chunker. */
export function ordinaryContextCase() {
  const body =
    "# İstehsal və texniki xidmət\n" +
    Array.from(
      { length: 16 },
      (_, index) =>
        `Sintetik müəssisənin ${index + 1}-ci bölməsində texniki xidmət planlaşdırılır. Hesabatda istehsal həcmi açıqlanmır. Bu məlumat istehsal gücünün zəif olduğunu sübut etmir. Heyətin hazırlığı və idxal komponentlərinin tədarükü ayrıca izlənilir. Yeni istehsal xəttinin işə salınması barədə tarix təqdim edilmir.`,
    ).join("\n\n");
  const chunks = chunkDocument(body, "Açıq sintetik hesabat").map(
    (chunk, index): AnalyticsContextChunk => ({
      id: contextId(600 + index),
      documentId: contextId(6010),
      briefId: null,
      text: chunk.text,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      ord: chunk.ord,
      sectionTitle: chunk.sectionTitle,
      isTable: chunk.isTable,
      embeddingModel: "synthetic-embedding",
    }),
  );
  const anchor = chunks[1]!;
  const primary = [anchor, { ...anchor, id: contextId(700), documentId: contextId(7010) }];
  return {
    id: "ordinary_chunked_prose",
    description:
      "Real chunker over synthetic Azerbaijani prose; selection frequency is observed, not a quality target",
    primary,
    sources: primary.map((chunk, index) => asSource(chunk, index + 1)),
    neighbors: chunks.filter((chunk) => Math.abs(chunk.ord - anchor.ord) === 1),
  };
}
