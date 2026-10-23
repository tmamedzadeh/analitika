import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { directionIds } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import { buildAnalyticsHistorySnapshot, getAnalyticsHistoryRecord } from "./history";
import type { AnalyticsSource } from "@/lib/analytics";
import { contextFixture } from "@/test/fixtures/analytics-context";
import { contextFingerprint, type AnalyticsContext } from "./context-identity";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => ({ transaction: (read: (db: unknown) => unknown) => read(drizzle(mocks.query)) }),
  };
});

describe("private expansion provenance in history", () => {
  function arrangeContext(change?: string) {
    const fixture = contextFixture();
    const primary = { ...fixture.primary[0]!, id: chunkId, documentId: id };
    const neighbor = { ...fixture.neighbors[0]!, documentId: id };
    const context: AnalyticsContext = {
      primary: [primary],
      auxiliary: [
        { anchorChunkId: chunkId, position: "before", chunk: neighbor, text: "Boundary context" },
      ],
    };
    const saved = { ...snapshot, contextChunks: [primary, neighbor].map(contextFingerprint) };
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (...args) => {
      const query = String(args[0]);
      if (query.includes('from "chunks"') && query.includes('"embedding_model"')) {
        let current = [primary, neighbor];
        if (change === "deleted") current = [primary];
        else if (change)
          current = [
            primary,
            {
              ...neighbor,
              ...(change === "uuid" ? { id: fixture.primary[1]!.id } : {}),
              ...(change === "text" ? { text: "changed" } : {}),
              ...(change === "offset" ? { charEnd: neighbor.charEnd + 1 } : {}),
              ...(change === "model" ? { embeddingModel: "changed" } : {}),
            },
          ];
        return {
          rows: current.map((chunk) => [
            chunk.id,
            chunk.documentId,
            chunk.briefId,
            chunk.text,
            chunk.charStart,
            chunk.charEnd,
            chunk.ord,
            chunk.sectionTitle,
            chunk.isTable,
            chunk.embeddingModel,
          ]),
        };
      }
      const result = await original(...args);
      if (query.includes('inner join "app_users"') && result.rows.length)
        result.rows[0][6] = [saved];
      return result;
    });
    return { context, primary, neighbor };
  }

  it("keeps one citable snapshot and stores only context fingerprints, never auxiliary text", async () => {
    const { context, primary } = arrangeContext();
    const source: AnalyticsSource = {
      ...snapshot,
      sourceKind: "document",
      title: "Synthetic",
      docDate: null,
      briefDate: null,
      direction: null,
      sectionTitle: primary.sectionTitle,
      text: primary.text,
      quote: "preview",
      charStart: primary.charStart,
      charEnd: primary.charEnd,
      isTable: false,
      attachmentCount: 0,
      classification: "open",
      sourceReliability: "A",
      infoCredibility: 1,
    };
    const result = buildAnalyticsHistorySnapshot(
      [source],
      "Answer [8]",
      "test",
      12,
      new Date(snapshot.createdAt),
      context,
    );
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]!.n).toBe(8);
    expect(result.snapshots[0]!.contextChunks).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/Boundary context|999|"text"|"quote"/);
    const record = await read();
    expect(record?.answer).toBe("Saved answer [8].");
    expect(record?.sources).toHaveLength(1);
    expect(record?.sources[0]).not.toHaveProperty("contextChunks");
    expect(
      mocks.query.mock.calls.filter(([query]) => query.includes('"embedding_model"')),
    ).toHaveLength(1);
  });

  it.each(["uuid", "text", "offset", "model", "deleted"])(
    "suppresses the saved answer when auxiliary %s changes, regardless of the current flag",
    async (change) => {
      arrangeContext(change);
      const record = await read();
      expect(record?.status).toBe("incomplete");
      expect(record?.answer).toBe(az.analytics.sourceUnavailable);
      expect(record?.sources[0]?.available).toBe(true); // The original citable evidence stays independent.
    },
  );

  it("does not read auxiliary payloads after parent access is revoked", async () => {
    arrange({ document: false });
    arrangeContext();
    const record = await read();
    expect(record?.answer).toBe(az.analytics.sourceUnavailable);
    expect(mocks.query.mock.calls.some(([query]) => query.includes('"embedding_model"'))).toBe(
      false,
    );
  });
});

const id = "00000000-0000-4000-8000-000000000001";
const chunkId = "00000000-0000-4000-8000-000000000002";
const user: SessionUser = {
  id: "reader",
  username: "analyst",
  role: "user",
  clearance: "open",
  sessionId: "session",
};
const filters = {
  period: "all",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};
const snapshot = {
  n: 8,
  documentId: id,
  briefId: null,
  chunkId,
  title: "Saved title",
  caption: "Saved section",
  usedInAnswer: true,
  maxClassification: "open",
  model: "test-model",
  durationMs: 12,
  createdAt: "2026-10-22T08:00:00.000Z",
};

function arrange(
  options: {
    active?: boolean;
    visible?: boolean;
    document?: boolean;
    chunk?: boolean;
    legacy?: boolean;
    malformed?: boolean;
    brief?: boolean;
    missingMetadata?: boolean;
    unknownCitation?: boolean;
    missingMapping?: boolean;
    duplicateNumber?: boolean;
    ambiguousParent?: boolean;
  } = {},
) {
  const saved = options.legacy ? { ...snapshot, chunkId: undefined } : { ...snapshot };
  if (options.brief) {
    saved.documentId = null as unknown as string;
    saved.briefId = id as unknown as null;
  }
  if (options.ambiguousParent) saved.briefId = id as unknown as null;
  const sources = options.missingMetadata
    ? [{ n: snapshot.n, documentId: id, chunkId }]
    : options.missingMapping
      ? []
      : options.duplicateNumber
        ? [saved, saved]
        : [saved];
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('select "id" from "app_users"'))
      return { rows: options.active === false ? [] : [[user.id]] };
    if (sql.includes('inner join "app_users"'))
      return {
        rows:
          options.visible === false
            ? []
            : [
                [
                  id,
                  user.id,
                  "Saved question",
                  filters,
                  "done",
                  options.unknownCitation ? "Saved answer [9]." : "Saved answer [8].",
                  options.malformed ? [{ n: -1 }] : sources,
                  "open",
                  "test-model",
                  12,
                  "2026-10-22T08:00:00.000Z",
                  user.username,
                ],
              ],
      };
    if (sql.includes('from "chunks"'))
      return {
        rows:
          options.chunk === false
            ? []
            : [[chunkId, "Current section", "Current authorized excerpt", false]],
      };
    if (sql.includes('from "documents"') && sql.startsWith('select "title"'))
      return {
        rows:
          options.document === false
            ? []
            : [["Current title", "2026-10-21", "OSINT", "D", 5, "open"]],
      };
    if (sql.includes('from "daily_briefs"') && sql.startsWith('select "title"'))
      return {
        rows: options.document === false ? [] : [["Current brief", "2026-10-21", "secret"]],
      };
    return { rows: [[id]] };
  });
}
const read = () => withCurrentUser(user, () => getAnalyticsHistoryRecord(id));
beforeEach(() => {
  vi.clearAllMocks();
  arrange();
});

describe("authorized current history previews", () => {
  it("loads legacy filters with bulletin search safely OFF", async () => {
    const record = await read();
    expect(record?.filters.includeBriefs).toBe(false);
  });

  it("preserves explicit bulletin selection when reloading history", async () => {
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (String(args[0]).includes('inner join "app_users"') && result.rows.length)
        result.rows[0][3] = { ...filters, includeBriefs: true };
      return result;
    });
    expect((await read())?.filters.includeBriefs).toBe(true);
  });
  it("preserves sparse citation IDs and reads current title, date, section, excerpt and ratings", async () => {
    const record = await read();
    expect(record?.answer).toBe("Saved answer [8].");
    expect(record?.sources[0]?.preview).toMatchObject({
      n: 8,
      documentId: id,
      chunkId,
      title: "Current title",
      docDate: "2026-10-21",
      sectionTitle: "Current section",
      quote: "Current authorized excerpt",
      sourceReliability: "D",
      infoCredibility: 5,
    });
    expect(record?.sources[0]).toMatchObject({
      title: "Current title",
      caption: "Current section",
    });
    expect(JSON.stringify(record)).not.toMatch(/Saved title|Saved section/);
    const calls = mocks.query.mock.calls as [string, unknown[]][];
    const documentRead = calls.find(([sql]) => sql.startsWith('select "title"'))!;
    expect(documentRead[0]).toContain('"app_users"."active" = true');
    expect(documentRead[0]).toContain('"app_users"."clearance"');
    expect(documentRead[0]).toContain("for share");
    const chunkRead = calls.find(([sql]) => sql.includes('from "chunks"'))!;
    expect(chunkRead[0]).toContain('"chunks"."document_id" =');
    expect(chunkRead[0]).toContain('"documents"."chunk_count" >');
    expect(chunkRead[1]).toEqual(expect.arrayContaining([chunkId, id]));
  });
  it.each([
    { active: false },
    { visible: false },
    { malformed: true },
    { duplicateNumber: true },
    { ambiguousParent: true },
  ])("returns no metadata or excerpts for invalid account/history: %j", async (options) => {
    arrange(options);
    expect(await read()).toBeNull();
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('from "chunks"'))).toBe(false);
  });
  it.each([{ document: false }, { chunk: false }])(
    "suppresses saved text and preview after source/chunk revocation: %j",
    async (options) => {
      arrange(options);
      const record = await read();
      expect(record?.status).toBe("incomplete");
      expect(record?.answer).toBe(az.analytics.sourceUnavailable);
      expect(record?.sources[0]).toMatchObject({
        n: 8,
        available: false,
        documentId: null,
        briefId: null,
        preview: null,
        title: az.analytics.sourceUnavailable,
      });
      expect(JSON.stringify(record)).not.toContain("Current authorized excerpt");
    },
  );
  it("keeps current legacy parent metadata navigable but withholds an unverifiable saved answer", async () => {
    arrange({ legacy: true });
    const record = await read();
    expect(record?.sources[0]).toMatchObject({
      n: 8,
      available: true,
      documentId: id,
      title: "Current title",
      caption: "",
      preview: {
        title: "Current title",
        sourceKind: "document",
        chunkId: "",
        sectionTitle: "",
        quote: "",
      },
    });
    expect(record?.status).toBe("incomplete");
    expect(record?.answer).toBe(az.analytics.sourceUnavailable);
    expect(JSON.stringify(record)).not.toMatch(/Saved title|Saved section|Saved answer/);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('from "chunks"'))).toBe(false);
  });
  it("resolves legacy snapshots with missing display metadata using their exact current fragment", async () => {
    arrange({ missingMetadata: true });
    const record = await read();
    expect(record?.answer).toBe("Saved answer [8].");
    expect(record?.sources[0]?.preview).toMatchObject({
      n: 8,
      title: "Current title",
      sectionTitle: "Current section",
      quote: "Current authorized excerpt",
    });
  });
  it.each([{ unknownCitation: true }, { missingMapping: true }])(
    "does not replay answer citations missing from verified history mappings: %j",
    async (options) => {
      arrange(options);
      const record = await read();
      expect(record?.status).toBe("incomplete");
      expect(record?.answer).toBe(az.analytics.sourceUnavailable);
      expect(JSON.stringify(record)).not.toContain("Saved answer");
    },
  );
  it("requires a published brief, committed index and exact parent for brief previews", async () => {
    arrange({ brief: true });
    const record = await read();
    expect(record?.sources[0]?.preview).toMatchObject({
      n: 8,
      sourceKind: "brief",
      classification: "secret",
      briefId: id,
      docDate: null,
      briefDate: "2026-10-21",
      sourceReliability: null,
      infoCredibility: null,
    });
    const sql = mocks.query.mock.calls.map(([query]) => query).join(" ");
    expect(sql).toContain('"daily_briefs"."status" =');
    expect(sql).toContain('"chunks"."brief_id" =');
    expect(sql).toContain('"daily_briefs"."index_status"');
  });
  it("adds only a chunk ID to snapshots, with no excerpt/text copy", () => {
    const source = {
      ...snapshot,
      sourceKind: "document",
      sectionTitle: "Section",
      classification: "open",
      text: "Private text",
      quote: "Private excerpt",
    } as unknown as AnalyticsSource;
    const result = buildAnalyticsHistorySnapshot(
      [source],
      "Answer [8].",
      "test-model",
      12,
      new Date(snapshot.createdAt),
    );
    expect(result.snapshots[0]).toMatchObject({ n: 8, chunkId, usedInAnswer: true });
    expect(JSON.stringify(result)).not.toMatch(/Private text|Private excerpt|"quote"|"text"/);
  });
});
