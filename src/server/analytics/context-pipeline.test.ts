import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { asSource, contextId, contextFixture } from "@/test/fixtures/analytics-context";
import { directionIds } from "@/lib/directions";
import type { TextGenerationInput } from "@/server/ai/types";
import { handleAnalyticsSearchRequest } from "./endpoint";
import { ANALYTICS_SERVER_DEADLINE_MS } from "@/lib/analytics";
import type { AnalyticsContextChunk } from "./context-identity";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  depth: 0,
  search: vi.fn(),
  dispatch: vi.fn(),
  save: vi.fn(),
  enabled: true,
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => {
      const db = drizzle(state.query);
      return {
        transaction: async (fn: (tx: typeof db) => unknown) => {
          state.depth++;
          try {
            return await fn(db);
          } finally {
            state.depth--;
          }
        },
      };
    },
  };
});
vi.mock("./search", () => ({ searchDocumentChunks: state.search }));
vi.mock("./rate-limit", () => ({ consumeAnalyticsRateLimit: async () => true }));
vi.mock("./history", async (original) => ({
  ...(await original<typeof import("./history")>()),
  createAnalyticsHistoryRecord: async () => {},
  updateAnalyticsHistoryRecord: state.save,
}));
vi.mock("@/server/config", () => ({
  getAppConfig: () => ({
    enableContextExpansion: state.enabled,
    embeddingModel: "synthetic-embedding",
    analyticsThinkingLevel: "low",
  }),
}));
vi.mock("@/server/ai/gemini", () => ({
  createGeminiProviders: () => ({
    analytics: {
      model: "synthetic-model",
      generateTextWithMetadata: async (input: TextGenerationInput) => {
        await input.beforeRequest?.();
        expect(state.depth).toBe(0);
        return state.dispatch(input);
      },
    },
  }),
}));
const user: SessionUser = {
  id: "synthetic",
  username: "synthetic",
  role: "user",
  clearance: "open",
  sessionId: "synthetic",
};
let fixture = contextFixture();
let current: AnalyticsContextChunk[];
let sqlFailure = false;
let active = true;
const row = (chunk: AnalyticsContextChunk) => [
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
];
beforeEach(() => {
  vi.clearAllMocks();
  fixture = contextFixture();
  current = [...fixture.primary, ...fixture.neighbors];
  state.enabled = true;
  sqlFailure = false;
  active = true;
  for (const method of ["info", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  state.search.mockResolvedValue(fixture.sources);
  state.dispatch.mockResolvedValue({
    text: "Synthetic plant operates steadily [1].",
    finishReason: "stop",
  });
  state.query.mockImplementation(async (query: string, params: unknown[]) => {
    expect(state.depth).toBe(1);
    if (query.includes("set_config")) return { rows: [] };
    if (query.startsWith('select "id", "clearance" from "app_users"'))
      return { rows: active ? [[user.id, "open"]] : [] };
    if (query.includes('from "documents"'))
      return { rows: fixture.primary.map((chunk) => [chunk.documentId, "open"]) };
    if (query.includes('from "chunks"')) {
      if (query.includes("not in") && sqlFailure) throw new Error("Synthetic optional SQL error");
      const selected = query.includes("not in")
        ? current.filter((chunk) => !fixture.primary.some((primary) => primary.id === chunk.id))
        : current.filter((chunk) => params.includes(chunk.id));
      return {
        rows: selected.map((chunk) =>
          query.includes('"embedding_model"') ? row(chunk) : row(chunk).slice(0, 6),
        ),
      };
    }
    throw new Error("Unexpected synthetic SQL");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const run = (mode = "answer") =>
  withCurrentUser(user, () =>
    handleAnalyticsSearchRequest(
      new Request("https://synthetic.test/api/analytics/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Synthetic plant",
          mode,
          filters: {
            period: "30d",
            includeBriefs: false,
            directionIds: [...directionIds],
            minSourceReliability: "all",
            minInfoCredibility: "all",
          },
        }),
      }),
    ),
  );

describe("context expansion through verified SSE pipeline", () => {
  it.each([10, 20])(
    "preserves all %i retrieved citations when auxiliary context is present",
    async (count) => {
      const anchor = fixture.primary[0]!;
      fixture.primary = Array.from({ length: count }, (_, index) => {
        const text = index ? `plant detail for district ${index} `.repeat(24) : anchor.text;
        return {
          ...anchor,
          id: index === 0 ? anchor.id : contextId(20 + index),
          documentId: index === 0 ? anchor.documentId : contextId(120 + index),
          text,
          charEnd: anchor.charStart + text.length,
        };
      });
      fixture.sources = fixture.primary.map((chunk, index) => asSource(chunk, index + 1));
      current = [...fixture.primary, ...fixture.neighbors];
      state.search.mockResolvedValue(fixture.sources);
      const output = await (await run()).text();
      const events = output
        .trim()
        .split("\n\n")
        .map((frame) => JSON.parse(frame.slice(6)));
      const sources = events.find((event) => event.type === "sources").sources;
      expect(sources.map((source: { n: number }) => source.n)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
      expect(sources.map((source: { chunkId: string }) => source.chunkId)).toEqual(
        fixture.primary.map((chunk) => chunk.id),
      );
      expect(events.at(-1).type).toBe("final");
      expect(state.dispatch).toHaveBeenCalledOnce();
      expect(state.dispatch.mock.calls[0]![0].prompt).toContain("Auxiliary Context");
      const saved = state.save.mock.calls.at(-1)![1];
      expect(saved.sources).toHaveLength(count);
      expect(saved.sources[0].contextChunks).toHaveLength(count + 2);
      expect(
        saved.sources[0].contextChunks.every((item: object) => !Object.hasOwn(item, "n")),
      ).toBe(true);
    },
  );
  it("adds only boundary context, keeps numbers/counts/history and makes one generation call outside transactions", async () => {
    const output = await (await run()).text();
    const events = output
      .trim()
      .split("\n\n")
      .map((frame) => JSON.parse(frame.slice(6)));
    expect(events.filter((event) => event.type === "progress").map((event) => event.stage)).toEqual(
      ["starting", "retrieval", "sources", "generation", "validation"],
    );
    expect(events.find((event) => event.type === "sources").sources).toHaveLength(2);
    expect(
      events
        .find((event) => event.type === "sources")
        .sources.map((source: { n: number }) => source.n),
    ).toEqual([1, 2]);
    expect(events.at(-1).type).toBe("final");
    expect(state.dispatch).toHaveBeenCalledOnce();
    expect(state.search).toHaveBeenCalledOnce();
    expect(state.depth).toBe(0);
    const input = state.dispatch.mock.calls[0]![0] as TextGenerationInput;
    expect(input.prompt).toContain("Auxiliary Context");
    expect(input.prompt).not.toMatch(/999|alien/);
    expect(output).not.toContain(fixture.neighbors[0]!.id);
    const saved = state.save.mock.calls.at(-1)![1];
    expect(saved.status).toBe("done");
    expect(saved.sources).toHaveLength(2);
    expect(saved.sources[0].contextChunks).toHaveLength(4);
    expect(JSON.stringify(saved.sources)).not.toContain("999");
    expect(
      saved.sources[0].contextChunks.every(
        (item: object) => !Object.hasOwn(item, "n") && !Object.hasOwn(item, "text"),
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    "preserves safe baseline for optional SQL failure (flag=%s)",
    async (enabled) => {
      state.enabled = enabled;
      sqlFailure = true;
      const output = await (await run()).text();
      expect(output).toContain('"type":"final"');
      expect(state.dispatch).toHaveBeenCalledOnce();
      expect(state.dispatch.mock.calls[0]![0].prompt).not.toContain("Auxiliary Context");
      expect(state.save.mock.calls.at(-1)![1].sources[0]).not.toHaveProperty("contextChunks");
      if (!enabled)
        expect(state.query.mock.calls.some(([query]) => query.includes('"embedding_model"'))).toBe(
          false,
        );
    },
  );

  it.each(["sources", "empty"])("does not expand or generate for %s mode", async (mode) => {
    if (mode === "empty") state.search.mockResolvedValue([]);
    const output = await (await run(mode === "sources" ? "sources" : "answer")).text();
    expect(output).toContain('"type":"final"');
    expect(state.dispatch).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(([query]) => query.includes('"embedding_model"'))).toBe(
      false,
    );
  });

  it.each(["auxiliary_replaced", "auxiliary_text", "primary_reindex", "account_revoked"])(
    "withholds a generated answer after %s",
    async (change) => {
      state.dispatch.mockImplementationOnce(async () => {
        if (change === "account_revoked") active = false;
        else if (change === "primary_reindex")
          current = current.map((chunk) => ({ ...chunk, id: `new-${chunk.id}` }));
        else
          current = current.map((chunk) =>
            chunk.id === fixture.neighbors[0]!.id
              ? change === "auxiliary_text"
                ? { ...chunk, text: "changed" }
                : { ...chunk, id: "new-neighbor" }
              : chunk,
          );
        return { text: "DO_NOT_PUBLISH [1].", finishReason: "stop" };
      });
      const output = await (await run()).text();
      expect(output).toContain('"type":"error"');
      expect(output).not.toMatch(/DO_NOT_PUBLISH|"type":"final"/);
      expect(state.dispatch).toHaveBeenCalledOnce();
      expect(state.depth).toBe(0);
      expect(state.save.mock.calls.at(-1)![1]).toMatchObject({
        status: "failed",
        sources: [],
        answer: "",
      });
    },
  );

  it("retains the complete context guard on a validation retry", async () => {
    state.dispatch.mockResolvedValueOnce({
      text: "private incomplete [1]",
      finishReason: "length",
    });
    const output = await (await run()).text();
    expect(output).toContain('"type":"final"');
    expect(output).not.toContain("private incomplete");
    expect(state.dispatch).toHaveBeenCalledTimes(2);
    expect(
      state.query.mock.calls.filter(
        ([query]) => query.includes('"embedding_model"') && !query.includes("not in"),
      ),
    ).toHaveLength(4); // capture, two dispatches, publication
  });

  it("does not retry generation after auxiliary context is revoked on the first completion", async () => {
    state.dispatch.mockImplementationOnce(async () => {
      current = current.filter((chunk) => chunk.id !== fixture.neighbors[0]!.id);
      return { text: "private incomplete [1]", finishReason: "length" };
    });
    const output = await (await run()).text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('"type":"final"');
    expect(state.dispatch).toHaveBeenCalledOnce();
  });

  it("rechecks auxiliary identity at fallback dispatch and does not send a revoked payload", async () => {
    const fallbackDispatch = vi.fn();
    state.dispatch.mockImplementationOnce(async (input: TextGenerationInput) => {
      current = current.filter((chunk) => chunk.id !== fixture.neighbors[0]!.id);
      input.onFallback?.({
        fromModel: "synthetic-model",
        toModel: "synthetic-backup",
        reason: "unavailable",
        backup: true,
      });
      await input.beforeRequest?.();
      fallbackDispatch();
      return { text: "private fallback [1]", finishReason: "stop" };
    });
    const output = await (await run()).text();
    expect(output).toContain('"type":"model-fallback"');
    expect(output).toContain('"type":"error"');
    expect(output).not.toMatch(/private fallback|"type":"final"/);
    expect(fallbackDispatch).not.toHaveBeenCalled();
    expect(state.dispatch).toHaveBeenCalledOnce();
  });

  it("does not turn an optional SQL failure into a permissive fallback after revocation", async () => {
    const original = state.query.getMockImplementation()!;
    state.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes("not in")) {
        active = false;
        throw new Error("Synthetic failure");
      }
      return original(...args);
    });
    const output = await (await run()).text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('"type":"final"');
    expect(state.dispatch).not.toHaveBeenCalled();
  });

  it("enforces the existing overall deadline during neighbor capture and ignores late completion", async () => {
    vi.useFakeTimers();
    let finish!: (value: { rows: unknown[] }) => void;
    const original = state.query.getMockImplementation()!;
    state.query.mockImplementation(async (...args) =>
      String(args[0]).includes("not in")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(...args),
    );
    const output = (await run()).text();
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    const stream = await output;
    expect(stream).toContain('"type":"error"');
    expect(stream).not.toContain('"type":"final"');
    expect(state.dispatch).not.toHaveBeenCalled();
    finish({ rows: fixture.neighbors.map(row) });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.dispatch).not.toHaveBeenCalled();
    expect(state.depth).toBe(0);
  });
});
