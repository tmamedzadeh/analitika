import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsFiltersSchema, type AnalyticsSource } from "@/lib/analytics";
import { AuthorizationError, withCurrentUser, type SessionUser } from "@/server/auth";
import { asSource, contextFixture, contextId } from "@/test/fixtures/analytics-context";
import { searchDocumentChunks } from "./search";
import { EvidenceContextBudgetError } from "./evidence-selection";
import type { RerankProvider } from "../ai/rerank";

const state = vi.hoisted(() => ({ query: vi.fn(), depth: 0 }));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => {
      const db = drizzle(state.query);
      return {
        select: db.select.bind(db),
        transaction: async (read: (tx: typeof db) => unknown) => {
          state.depth++;
          try {
            return await read(db);
          } finally {
            state.depth--;
          }
        },
      };
    },
  };
});
vi.mock("@/server/config", () => ({
  getAppConfig: () => ({ embeddingDimensions: 3, enableRerank: false }),
}));
vi.mock("@/server/ai/gemini", () => ({
  createGeminiProviders: () => ({ embeddings: { model: "synthetic" } }),
}));

const user: SessionUser = {
  id: "reader",
  username: "reader",
  role: "user",
  clearance: "open",
  sessionId: "synthetic",
};
let pool: AnalyticsSource[];
let denied: Set<string>;
let vectorIds: Set<string>;
const identity = (source: AnalyticsSource) => source.documentId ?? source.briefId!;
beforeEach(() => {
  vi.clearAllMocks();
  state.depth = 0;
  denied = new Set();
  vectorIds = new Set();
  const anchor = contextFixture().primary[0]!;
  pool = Array.from({ length: 30 }, (_, index) => {
    const text = `Synthetic plant district ${index} produced ${40 + index} units.`;
    const brief = index % 2 === 1;
    return asSource(
      {
        ...anchor,
        id: contextId(index + 1),
        documentId: brief ? null : contextId(100 + index),
        briefId: brief ? contextId(100 + index) : null,
        text,
        charStart: 0,
        charEnd: text.length,
      },
      index + 1,
    );
  });
  state.query.mockImplementation(async (query: string, params: unknown[]) => {
    if (query.startsWith('select "clearance" from "app_users"')) return { rows: [["open"]] };
    if (query.startsWith('select "id", "clearance" from "app_users"'))
      return { rows: [[user.id, "open"]] };
    if (query.includes('from "chunks" left join')) {
      const kind =
        query.lastIndexOf('"chunks"."brief_id" is not null') >
        query.lastIndexOf('"chunks"."document_id" is not null')
          ? "brief"
          : "document";
      const candidates = pool.filter(
        (source) =>
          source.sourceKind === kind && (!query.includes(" <=> ") || vectorIds.has(source.chunkId)),
      );
      return {
        rows: candidates.map((s) => [
          s.chunkId,
          s.chunkId,
          s.sourceKind,
          s.documentId,
          s.briefId,
          s.title,
          s.docDate,
          s.briefDate,
          s.direction,
          s.sectionTitle,
          s.text,
          s.charStart,
          s.charEnd,
          s.isTable,
          s.sourceReliability,
          s.infoCredibility,
          s.classification,
        ]),
      };
    }
    if (query.includes('from "chunks"'))
      return {
        rows: pool
          .filter((source) => params.includes(source.chunkId))
          .map((s) => [s.chunkId, s.documentId, s.briefId, s.text, s.charStart, s.charEnd]),
      };
    if (query.includes('from "documents"') || query.includes('from "daily_briefs"'))
      return {
        rows: pool
          .filter((source) => !denied.has(identity(source)))
          .map((source) => [identity(source), "open"]),
      };
    if (query.includes('from "attachments"') || query.includes('from "brief_attachments"'))
      return {
        rows: pool.map((source) => [identity(source), source.sourceKind === "brief" ? 3 : 2]),
      };
    throw new Error("Unexpected offline SQL");
  });
});
const run = (includeBriefs: boolean, provider?: RerankProvider) =>
  withCurrentUser(user, () =>
    searchDocumentChunks(
      "synthetic plant",
      analyticsFiltersSchema.parse({
        includeBriefs,
        period: "all",
        directionIds: ["OSINT"],
        minSourceReliability: "all",
        minInfoCredibility: "all",
      }),
      {
        embedding: [1, 0, 0],
        embeddingModel: "synthetic",
        enableRerank: Boolean(provider),
        ...(provider ? { rerankProvider: provider } : {}),
      },
    ),
  );

describe("authorized evidence selection in real hybrid retrieval", () => {
  it.each(["characters", "bytes"])(
    "distinguishes all-oversized %s evidence from absent or unauthorized sources",
    async (limit) => {
      pool = [
        {
          ...pool[0]!,
          text: "Synthetic plant " + (limit === "bytes" ? "界".repeat(16_000) : "x".repeat(23_000)),
        },
      ];
      pool[0]!.charEnd = pool[0]!.text.length;
      await expect(run(false)).rejects.toBeInstanceOf(EvidenceContextBudgetError);
      // Unauthorized evidence must not disclose that a matching source exists.
      denied.add(identity(pool[0]!));
      expect(await run(false)).toEqual([]);
      pool = [];
      expect(await run(false)).toEqual([]);
    },
  );

  it("preserves and revalidates duplicate material UUIDs independently", async () => {
    pool = [pool[0]!, { ...pool[2]!, text: pool[0]!.text, charEnd: pool[0]!.charEnd }];
    const result = await run(false);
    expect(result.map((source) => source.chunkId)).toEqual(pool.map((source) => source.chunkId));
    denied.add(identity(pool[1]!));
    expect((await run(false)).map((source) => source.chunkId)).toEqual([pool[0]!.chunkId]);
  });
  it.each([false, true])(
    "keeps includeBriefs=%s, ACL, rerank order, numbering and links through twenty slots",
    async (includeBriefs) => {
      for (const source of pool.slice(0, 2)) denied.add(identity(source));
      const expected = pool.filter(
        (source) =>
          (includeBriefs || source.sourceKind === "document") && !denied.has(identity(source)),
      );
      const rerank = vi.fn<RerankProvider["rerank"]>(async (_query, candidates, options) => {
        expect(state.depth).toBe(0);
        await options?.beforeRequest?.();
        expect(candidates).toHaveLength(expected.length);
        expect(
          candidates.every((candidate) =>
            expected.some((source) => source.chunkId === candidate.id),
          ),
        ).toBe(true);
        return expected.map((source) => source.chunkId).reverse();
      });
      const result = await run(includeBriefs, { rerank });
      expect(rerank).toHaveBeenCalledOnce();
      expect(result.map((source) => source.chunkId)).toEqual(
        expected
          .map((source) => source.chunkId)
          .reverse()
          .slice(0, 20),
      );
      expect(result.map((source) => source.n)).toEqual(
        Array.from({ length: Math.min(20, expected.length) }, (_, index) => index + 1),
      );
      for (const source of result) {
        expect(source.documentId ?? source.briefId).toBe(
          identity(pool.find((item) => item.chunkId === source.chunkId)!),
        );
        expect(source.attachmentCount).toBe(source.sourceKind === "brief" ? 3 : 2);
      }
      if (!includeBriefs)
        expect(result.every((source) => source.sourceKind === "document")).toBe(true);
      expect(state.depth).toBe(0);
    },
  );

  it("carries actual vector membership into selection so semantic synonyms survive", async () => {
    pool = [
      pool[0]!,
      {
        ...pool[2]!,
        title: "Report",
        sectionTitle: "Capacity",
        text: "The factory manufactured forty units.",
      },
    ];
    pool[1]!.charEnd = pool[1]!.text.length;
    vectorIds.add(pool[1]!.chunkId);
    expect(await run(false)).toHaveLength(2);
    vectorIds.clear();
    expect(await run(false)).toHaveLength(1);
  });

  it("revalidates all rerank inputs, including evidence outside the final twenty", async () => {
    const revoked = pool.at(-1)!;
    await expect(
      run(true, {
        rerank: async (_query, candidates, options) => {
          await options?.beforeRequest?.();
          denied.add(identity(revoked));
          return candidates.map((candidate) => candidate.id);
        },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(state.depth).toBe(0);
  });
});
