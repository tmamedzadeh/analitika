import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsFiltersSchema } from "@/lib/analytics";
import { directionIds } from "@/lib/directions";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { searchDocumentChunks } from "./search";

const mocks = vi.hoisted(() => ({ query: vi.fn(), embed: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { getDb: () => drizzle(mocks.query) };
});
vi.mock("@/server/ai/gemini", () => ({
  createGeminiProviders: () => ({ embeddings: { model: "synthetic", embedQuery: mocks.embed } }),
}));
vi.mock("@/server/config", () => ({
  getAppConfig: () => ({ embeddingDimensions: 768, enableRerank: false }),
}));
const user: SessionUser = {
  id: "reader",
  username: "reader",
  role: "user",
  clearance: "open",
  sessionId: "synthetic",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from "app_users"') && !sql.includes('from "chunks"') ? [["open"]] : [],
  }));
});
describe("analytics retrieval branch selection", () => {
  it.each([false, true])(
    "dispatches only requested branches (includeBriefs=%s) with access and period checks",
    async (includeBriefs) => {
      const filters = analyticsFiltersSchema.parse({
        period: "30d",
        directionIds: ["OSINT"],
        minSourceReliability: "B",
        minInfoCredibility: "2",
        includeBriefs,
      });
      const result = await withCurrentUser(user, () =>
        searchDocumentChunks("synthetic", filters, {
          embedding: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
          embeddingModel: "synthetic",
          enableRerank: false,
        }),
      );
      expect(result).toEqual([]);
      const calls = mocks.query.mock.calls.filter(([query]) =>
        String(query).includes('from "chunks"'),
      );
      expect(calls).toHaveLength(includeBriefs ? 6 : 3);
      const briefCalls = calls.filter(([query]) =>
        String(query).includes('"chunks"."brief_id" is not null'),
      );
      expect(briefCalls).toHaveLength(includeBriefs ? 6 : 0); // Source OR appears in each ON query.
      for (const [query] of calls) {
        expect(query).toContain('"app_users"."active" = true');
        expect(query).toContain('"documents"."classification"');
        if (includeBriefs) {
          expect(query).toContain('"daily_briefs"."classification"');
          expect(query).toContain('"daily_briefs"."brief_date" >=');
        }
      }
      expect(mocks.embed).not.toHaveBeenCalled();
    },
  );
});
