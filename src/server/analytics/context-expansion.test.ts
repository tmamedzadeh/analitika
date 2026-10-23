import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contextFixture } from "@/test/fixtures/analytics-context";
import { AuthorizationError } from "@/server/auth";
import { prepareAnalyticsContext } from "./context-expansion";
import { requireAnalyticsSourceAccess, withAnalyticsSourceAccess } from "./source-access";
import { contextChunks, type AnalyticsContextChunk } from "./context-identity";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  getDb: vi.fn(),
  depth: 0,
  onUnlock: undefined as (() => void) | undefined,
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => {
      state.getDb();
      const db = drizzle(state.query);
      return {
        select: db.select.bind(db),
        transaction: async (operation: (tx: typeof db) => unknown) => {
          state.depth++;
          try {
            return await operation(db);
          } finally {
            state.depth--;
            if (!state.depth) state.onUnlock?.();
          }
        },
      };
    },
  };
});
const user = { id: "reader", clearance: "open" as const };
let fixture = contextFixture();
let current: AnalyticsContextChunk[];
let active = true;
let parent = true;
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
  active = true;
  parent = true;
  state.onUnlock = undefined;
  vi.spyOn(console, "info").mockImplementation(() => {});
  state.query.mockImplementation(async (query: string, params: unknown[]) => {
    expect(state.depth).toBe(1);
    if (query.includes("set_config")) return { rows: [] };
    if (query.startsWith('select "id", "clearance" from "app_users"'))
      return { rows: active ? [[user.id, "special"]] : [] };
    if (query.includes('from "documents"'))
      return { rows: parent ? fixture.primary.map((chunk) => [chunk.documentId, "open"]) : [] };
    if (query.includes('from "daily_briefs"'))
      return { rows: parent ? fixture.primary.map((chunk) => [chunk.briefId, "open"]) : [] };
    if (query.includes('from "chunks"')) {
      const selected = query.includes("not in")
        ? current.filter((chunk) => !fixture.primary.some((item) => item.id === chunk.id))
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
const prepare = (signal = new AbortController().signal, enabled = true) =>
  prepareAnalyticsContext(fixture.sources, user, {
    enabled,
    embeddingModel: "synthetic-embedding",
    signal,
  });

describe("batched context capture and publication revalidation", () => {
  it("does no DB work with the flag OFF and logs only bounded operational fields", async () => {
    expect(await prepare(undefined, false)).toBeUndefined();
    expect(state.getDb).not.toHaveBeenCalled();
    expect(state.query).not.toHaveBeenCalled();
    const logged = vi.mocked(console.info).mock.calls.join(" ");
    expect(logged).toContain('"enabled":false');
    expect(logged).not.toMatch(/synthetic plant|999|00000000/);
  });

  it("captures both sides in one neighbor query under parent locks, then releases all locks", async () => {
    const context = await prepare();
    expect(context?.auxiliary).toHaveLength(2);
    expect(state.depth).toBe(0);
    const sql = state.query.mock.calls.map(([query]) => query as string);
    expect(sql.filter((query) => query.includes("not in"))).toHaveLength(1);
    expect(sql).toHaveLength(6); // local limits, user, parents, exact baseline, context identities, batch neighbors
    expect(sql[0]).toContain("'statement_timeout', '250ms', true");
    expect(sql[0]).toContain("'lock_timeout', '100ms', true");
    expect(sql.slice(1).every((query) => query.includes("for share"))).toBe(true);
    expect(sql.at(-1)).toMatch(/"ord" in .*"embedding_model".*"section_title".*limit.*for share/s);
    await requireAnalyticsSourceAccess(fixture.sources, user, contextChunks(context!));
    expect(state.depth).toBe(0);
    const publish = vi.fn(() => "published");
    await withAnalyticsSourceAccess(fixture.sources, user.id, publish, contextChunks(context!));
    expect(publish).toHaveBeenCalledOnce();
  });

  it.each(["uuid", "text", "offset", "model", "section", "ord", "parent", "deleted"])(
    "rejects changed auxiliary %s before dispatch/publication",
    async (kind) => {
      const context = (await prepare())!;
      const used = context.auxiliary[0]!.chunk;
      current = current.map((chunk) => {
        if (chunk.id !== used.id) return chunk;
        if (kind === "uuid") return { ...chunk, id: "replacement" };
        if (kind === "text") return { ...chunk, text: chunk.text + "changed" };
        if (kind === "offset") return { ...chunk, charEnd: chunk.charEnd + 1 };
        if (kind === "model") return { ...chunk, embeddingModel: "different" };
        if (kind === "section") return { ...chunk, sectionTitle: "different" };
        if (kind === "ord") return { ...chunk, ord: 8 };
        if (kind === "parent") return { ...chunk, documentId: fixture.primary[1]!.documentId };
        return chunk;
      });
      if (kind === "deleted") current = current.filter((chunk) => chunk.id !== used.id);
      await expect(
        requireAnalyticsSourceAccess(fixture.sources, user, contextChunks(context)),
      ).rejects.toBeInstanceOf(AuthorizationError);
      const publish = vi.fn();
      await expect(
        withAnalyticsSourceAccess(fixture.sources, user.id, publish, contextChunks(context)),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(publish).not.toHaveBeenCalled();
      expect(state.depth).toBe(0);
    },
  );

  it.each(["uuid", "text", "offset", "deleted_parent", "revoked"])(
    "fails closed if baseline changed before neighbor capture: %s",
    async (kind) => {
      if (kind === "deleted_parent") parent = false;
      else if (kind === "revoked") active = false;
      else
        current = current.map((chunk) =>
          chunk.id === fixture.primary[0]!.id
            ? kind === "uuid"
              ? { ...chunk, id: "new-generation" }
              : kind === "text"
                ? { ...chunk, text: "replaced" }
                : { ...chunk, charStart: 1 }
            : chunk,
        );
      await expect(prepare()).rejects.toBeInstanceOf(AuthorizationError);
      expect(state.query.mock.calls.some(([query]) => query.includes("not in"))).toBe(false);
    },
  );

  it("rejects a whole-index replacement after capture and never accepts mixed generations", async () => {
    const context = (await prepare())!;
    current = current.map((chunk) => ({ ...chunk, id: `new-${chunk.id}` }));
    await expect(
      requireAnalyticsSourceAccess(fixture.sources, user, contextChunks(context)),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(prepare()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("supports brief parents with the same snapshot and publication guarantees", async () => {
    fixture.primary = fixture.primary.map((chunk) => ({
      ...chunk,
      briefId: chunk.documentId,
      documentId: null,
    }));
    fixture.neighbors = fixture.neighbors.map((chunk) => ({
      ...chunk,
      briefId: chunk.documentId,
      documentId: null,
    }));
    fixture.sources = fixture.sources.map((source) => ({
      ...source,
      sourceKind: "brief",
      briefId: source.documentId,
      documentId: null,
    }));
    current = [...fixture.primary, ...fixture.neighbors];
    const context = await prepare();
    expect(context?.auxiliary).toHaveLength(2);
    expect(state.query.mock.calls.map(([query]) => query).join(" ")).toContain(
      '"daily_briefs"."status"',
    );
    await requireAnalyticsSourceAccess(fixture.sources, user, contextChunks(context!));
  });

  it("models a parent-locked atomic writer waiting for capture, then revokes the old generation", async () => {
    let unlock!: () => void;
    const released = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    state.onUnlock = unlock;
    let writer: Promise<void> | undefined;
    const original = state.query.getMockImplementation()!;
    state.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes("not in")) {
        writer = released.then(() => {
          current = current.map((chunk) => ({ ...chunk, id: `new-${chunk.id}` }));
        });
        expect(state.depth).toBe(1);
        expect(current[0]!.id).toBe(fixture.primary[0]!.id);
      }
      return original(...args);
    });
    const context = (await prepare())!;
    await writer;
    expect(context.primary.map((chunk) => chunk.id)).toEqual(
      fixture.primary.map((chunk) => chunk.id),
    );
    expect(
      context.auxiliary.every((item) =>
        fixture.neighbors.some((neighbor) => neighbor.id === item.chunk.id),
      ),
    ).toBe(true);
    await expect(
      requireAnalyticsSourceAccess(fixture.sources, user, contextChunks(context)),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("skips embedding mismatch and missing useful neighbors without widening baseline", async () => {
    current = current.map((chunk) => ({ ...chunk, embeddingModel: "old" }));
    expect(await prepare()).toBeUndefined();
    expect(state.query.mock.calls.some(([query]) => query.includes("not in"))).toBe(false);
    current = fixture.primary;
    expect(await prepare()).toBeUndefined();
  });

  it("rolls back optional SQL failure and allows only a freshly authorized baseline", async () => {
    const original = state.query.getMockImplementation()!;
    state.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes("not in")) throw new Error("private SQL text");
      return original(...args);
    });
    expect(await prepare()).toBeUndefined();
    expect(state.depth).toBe(0);
    await expect(requireAnalyticsSourceAccess(fixture.sources, user)).resolves.toHaveLength(2);
    active = false;
    await expect(requireAnalyticsSourceAccess(fixture.sources, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(vi.mocked(console.info).mock.calls.join(" ")).not.toContain("private SQL text");
  });

  it.each(["AbortError", "TimeoutError"])(
    "propagates %s, observes a late DB completion and does not fall back",
    async (name) => {
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
      const controller = new AbortController();
      const pending = prepare(controller.signal);
      const settled = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(finish).toBeDefined();
      controller.abort(new DOMException("Synthetic stop", name));
      expect(await settled).toHaveProperty("name", name);
      finish({ rows: fixture.neighbors.map(row) });
      await vi.advanceTimersByTimeAsync(0);
      expect(state.depth).toBe(0);
    },
  );
});
