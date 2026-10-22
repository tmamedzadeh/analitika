import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSource } from "@/lib/analytics";
import { sameAnalyticsSourceSet, withAnalyticsSourceAccess } from "./source-access";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => ({
      transaction: (publish: (db: unknown) => unknown) => publish(drizzle(mocks.query)),
    }),
  };
});

const source: AnalyticsSource = {
  n: 1,
  sourceKind: "document",
  chunkId: "00000000-0000-4000-8000-000000000001",
  documentId: "00000000-0000-4000-8000-000000000002",
  briefId: null,
  title: "Document",
  docDate: null,
  briefDate: null,
  direction: "OSINT",
  sectionTitle: "Section",
  text: "Exact authorized evidence",
  quote: "Exact authorized evidence",
  charStart: 0,
  charEnd: 25,
  isTable: false,
  attachmentCount: 0,
  sourceReliability: "A",
  infoCredibility: 1,
  classification: "open",
};

function arrange(
  options: {
    active?: boolean;
    parent?: boolean;
    chunk?: boolean;
    text?: string;
    documentId?: string | null;
    charEnd?: number;
    brief?: boolean;
  } = {},
) {
  mocks.query.mockImplementation(async (query: string) => {
    if (query.startsWith('select "id", "clearance" from "app_users"'))
      return { rows: options.active === false ? [] : [["reader", "special"]] };
    if (query.includes('from "chunks"'))
      return {
        rows:
          options.chunk === false
            ? []
            : [
                [
                  source.chunkId,
                  options.brief
                    ? null
                    : options.documentId === undefined
                      ? source.documentId
                      : options.documentId,
                  options.brief ? source.documentId : null,
                  options.text ?? source.text,
                  source.charStart,
                  options.charEnd ?? source.charEnd,
                ],
              ],
      };
    return { rows: options.parent === false ? [] : [[source.documentId, "secret"]] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  arrange();
});

describe("source publication authorization", () => {
  it("locks the live account, current parent and exact fragment while publishing", async () => {
    const publish = vi.fn((available) => available);
    const result = await withAnalyticsSourceAccess([source], "reader", publish);
    expect(result.sources).toEqual([{ ...source, classification: "secret" }]);
    expect(publish).toHaveBeenCalledWith(result.sources, "special");
    const sql = mocks.query.mock.calls.map(([query]) => query).join(" ");
    expect(sql.match(/for share/gu)).toHaveLength(3);
    expect(sql).toContain('"app_users"."active" = true');
    expect(sql).toContain('"app_users"."clearance"');
    expect(sql).toContain('"documents"."chunk_count" >');
  });

  it.each([
    { parent: false },
    { chunk: false },
    { text: "Changed source text" },
    { documentId: "00000000-0000-4000-8000-000000000099" },
    { charEnd: 26 },
  ])("withholds a revoked, replaced, moved or modified source: %j", async (options) => {
    arrange(options);
    const publish = vi.fn();
    const result = await withAnalyticsSourceAccess([source], "reader", publish);
    expect(result.sources).toEqual([]);
    expect(publish).toHaveBeenCalledWith([], "special");
  });

  it("does not read parent or chunk text for a deactivated account", async () => {
    arrange({ active: false });
    const publish = vi.fn();
    await withAnalyticsSourceAccess([source], "reader", publish);
    expect(publish).toHaveBeenCalledWith([], "unknown");
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("rechecks the live question clearance even when retrieval returned no sources", async () => {
    const publish = vi.fn();
    await withAnalyticsSourceAccess([], "reader", publish);
    expect(publish).toHaveBeenCalledWith([], "special");
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("requires published briefs and their committed index before publication", async () => {
    arrange({ brief: true });
    const brief = {
      ...source,
      sourceKind: "brief" as const,
      documentId: null,
      briefId: source.documentId,
    };
    const result = await withAnalyticsSourceAccess([brief], "reader", (available) => available);
    expect(result.sources).toEqual([{ ...brief, classification: "secret" }]);
    const sql = mocks.query.mock.calls.map(([query]) => query).join(" ");
    expect(sql).toContain('"daily_briefs"."status" =');
    expect(sql).toContain('"daily_briefs"."index_status"');
    expect(sql).toContain('"app_users"."clearance"');
  });
});

describe("citation mapping integrity across publication checks", () => {
  const other = { ...source, n: 2, chunkId: "other-chunk" };
  it("accepts unchanged mappings with refreshed classification", () => {
    expect(sameAnalyticsSourceSet([source], [{ ...source, classification: "secret" }])).toBe(true);
  });
  it.each([
    [other, source],
    [source, { ...other, n: 3 }],
    [source, { ...other, documentId: "other-parent" }],
    [source, { ...other, sourceKind: "brief" as const }],
    [source],
  ])("rejects a changed citation-to-fragment mapping: %j", (...actual) => {
    expect(sameAnalyticsSourceSet([source, other], actual)).toBe(false);
  });
  it("rejects duplicate IDs hiding a different source", () => {
    expect(sameAnalyticsSourceSet([source, source], [source, other])).toBe(false);
  });
});
