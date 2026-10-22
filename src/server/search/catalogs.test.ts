import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { buildBriefListConditions, listBriefsPage } from "@/server/briefs/queries";
import {
  documentListConditions,
  documentListSchema,
  listDocumentsPage,
} from "@/server/documents/queries";
import { lexicalSearchSql } from "./sql";
import { dailyBriefs, chunks } from "@/server/db/schema";

const mocks = vi.hoisted(() => ({ query: vi.fn(), ai: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { getDb: () => drizzle(mocks.query) };
});
vi.mock("@/server/ai/gemini", () => ({ createGeminiProviders: mocks.ai }));
const user: SessionUser = {
  id: "synthetic-user",
  username: "test",
  role: "user",
  clearance: "open",
  sessionId: "test",
};
const compile = (conditions: ReturnType<typeof buildBriefListConditions>) =>
  conditions.map((condition) => new PgDialect().sqlToQuery(condition));
const defaults = { query: "", period: "all" as const, month: "", cursor: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("catalog SQL authorization, ordering and pagination", () => {
  it("keeps the bulletin index expression and AND groups alongside live access and month bounds", () =>
    withCurrentUser(user, () => {
      const conditions = compile(
        buildBriefListConditions({
          ...defaults,
          query: "müdafiə nazir təsdiq",
          month: "2026-10",
          cursor: { date: "2026-10-18", id: "00000000-0000-4000-8000-000000000001", score: 100 },
        }),
      );
      const sql = conditions.map(({ sql }) => sql).join(" "),
        params = conditions.flatMap(({ params }) => params);
      expect(sql).toContain("to_tsvector('simple'::regconfig, lower(translate(normalize(");
      expect(sql).toContain('"app_users"."active" = true');
      expect(sql).toContain('"daily_briefs"."brief_date" >=');
      expect(sql).toContain('"daily_briefs"."brief_date" <=');
      expect(sql).toContain('"daily_briefs"."id" <');
      expect(params).toEqual(expect.arrayContaining([user.id, "2026-10-01", "2026-10-31", 100]));
      expect(
        params.filter((value) => typeof value === "string" && value.includes("nazirinin")).length,
      ).toBeGreaterThan(0);
    }));
  it("keeps clearance, direction and relevance/date/ID in document requests", () =>
    withCurrentUser(user, () => {
      const compiled = compile(
        documentListConditions(
          documentListSchema.parse({
            query: "İran",
            direction: "OSINT",
            cursor: {
              createdAt: "2026-10-18T10:00:00.000Z",
              id: "00000000-0000-4000-8000-000000000001",
              score: 7500,
            },
          }),
        ),
      );
      const sql = compiled.map(({ sql }) => sql).join(" "),
        params = compiled.flatMap(({ params }) => params);
      expect(sql).toContain('"documents"."classification"');
      expect(sql).toContain('"app_users"."clearance"');
      expect(sql).toContain('"app_users"."active" = true');
      expect(sql).toContain('"documents"."direction" =');
      expect(sql).toContain('"documents"."created_at" <');
      expect(sql).toContain('"documents"."id" <');
      expect(params).toEqual(expect.arrayContaining([user.id, "OSINT", 7500]));
    }));
  it("sorts active searches by score with date/ID ties, and never constructs AI providers", async () =>
    withCurrentUser(user, async () => {
      await listBriefsPage({ ...defaults, query: "Iran" });
      await listDocumentsPage(documentListSchema.parse({ query: "Iran" }));
      for (const [sql, params] of mocks.query.mock.calls) {
        expect(sql).toMatch(/order by search_score desc, .* desc, .* desc limit /);
        expect(params.at(-1)).toBe(13);
      }
      expect(mocks.ai).not.toHaveBeenCalled();
      mocks.query.mockClear();
      await listBriefsPage(defaults);
      await listDocumentsPage(documentListSchema.parse({}));
      for (const [sql] of mocks.query.mock.calls)
        expect(sql).not.toContain("order by search_score");
    }));
  it("loads beyond eight documents, emits a score cursor, and keeps card previews free of internal fields", async () =>
    withCurrentUser(user, async () => {
      mocks.query.mockResolvedValueOnce({
        rows: Array.from({ length: 13 }, (_, i) => [
          `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          `İran ${i}`,
          "2026-10-18",
          "2026-10-18T10:00:00.123456Z",
          "OSINT",
          "open",
          "ready",
          "# Synthetic preview",
          false,
          false,
          7500,
        ]),
      });
      const page = await listDocumentsPage(documentListSchema.parse({ query: "Iran" }));
      expect(page.items).toHaveLength(12);
      expect(page.nextCursor?.score).toBe(7500);
      expect(page.nextCursor?.createdAt).toBe("2026-10-18T10:00:00.123456Z");
      expect(page.nextCursor?.id).toBe(page.items.at(-1)?.id);
      expect(page.items[0]).not.toHaveProperty("chunkCount");
      expect(page.items[0]).not.toHaveProperty("score");
      expect(page.items[0]?.preview).toBe("Synthetic preview");
    }));
  it("parameterizes malicious text and keeps raw chunk FTS with normalized I rechecks", () => {
    const query = "Iran'); DROP TABLE documents; --";
    const result = new PgDialect().sqlToQuery(
      lexicalSearchSql(
        query,
        { title: dailyBriefs.title, body: chunks.text, vector: chunks.tsv, rawVector: true },
        "any",
      ).match,
    );
    expect(result.sql).not.toContain("DROP TABLE");
    expect(result.sql).toContain('"chunks"."tsv" @@');
    expect(result.sql).toContain("lower(translate(normalize(");
    expect(result.params.every((param) => typeof param !== "string" || !param.includes(";"))).toBe(
      true,
    );
  });
});
