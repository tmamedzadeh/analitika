import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { directionIds } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import { buildAnalyticsHistorySnapshot, getAnalyticsHistoryRecord } from "./history";
import type { AnalyticsSource } from "@/lib/analytics";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => ({ transaction: (read: (db: unknown) => unknown) => read(drizzle(mocks.query)) }),
  };
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
  } = {},
) {
  const saved = options.legacy ? { ...snapshot, chunkId: undefined } : { ...snapshot };
  if (options.brief) {
    saved.documentId = null as unknown as string;
    saved.briefId = id as unknown as null;
  }
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
                  "Saved answer [8].",
                  options.malformed ? [{ n: -1 }] : [saved],
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
      return { rows: options.document === false ? [] : [["Current brief", "2026-10-21"]] };
    return { rows: [[id]] };
  });
}
const read = () => withCurrentUser(user, () => getAnalyticsHistoryRecord(id));
beforeEach(() => {
  vi.clearAllMocks();
  arrange();
});

describe("authorized current history previews", () => {
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
  it.each([{ active: false }, { visible: false }, { malformed: true }])(
    "returns no metadata or excerpts for invalid account/history: %j",
    async (options) => {
      arrange(options);
      expect(await read()).toBeNull();
      expect(mocks.query.mock.calls.some(([sql]) => sql.includes('from "chunks"'))).toBe(false);
    },
  );
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
  it("keeps legacy sources navigable without fabricating an excerpt", async () => {
    arrange({ legacy: true });
    const record = await read();
    expect(record?.sources[0]).toMatchObject({
      n: 8,
      available: true,
      documentId: id,
      preview: null,
    });
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('from "chunks"'))).toBe(false);
  });
  it("requires a published brief, committed index and exact parent for brief previews", async () => {
    arrange({ brief: true });
    const record = await read();
    expect(record?.sources[0]?.preview).toMatchObject({
      n: 8,
      sourceKind: "brief",
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
