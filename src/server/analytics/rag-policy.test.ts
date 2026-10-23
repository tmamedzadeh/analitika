import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { directionIds } from "@/lib/directions";
import { handleAnalyticsSearchRequest } from "./endpoint";
import { clearGeminiModelCooldowns } from "@/server/ai/gemini-gateway";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  transactionDepth: 0,
  classification: "open",
  active: true,
  chunkAvailable: true,
  saveHistory: vi.fn(),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    getDb: () => {
      const db = drizzle(state.query);
      return {
        select: db.select.bind(db),
        transaction: async (read: (tx: typeof db) => unknown) => {
          state.transactionDepth++;
          try {
            return await read(db);
          } finally {
            state.transactionDepth--;
          }
        },
      };
    },
  };
});
vi.mock("./rate-limit", () => ({ consumeAnalyticsRateLimit: async () => true }));
vi.mock("./history", async (original) => ({
  ...(await original<typeof import("./history")>()),
  createAnalyticsHistoryRecord: async () => {},
  updateAnalyticsHistoryRecord: state.saveHistory,
}));

const documentId = "00000000-0000-4000-8000-000000000001";
const chunkId = "00000000-0000-4000-8000-000000000002";
const text = "Synthetic plant produced 42 units.";
const vector = Array.from({ length: 768 }, (_, index) => (index === 0 ? 1 : 0));
const user: SessionUser = {
  id: "synthetic-reader",
  username: "synthetic",
  role: "user",
  clearance: "open",
  sessionId: "test",
};
const filters = {
  period: "all",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};
function request() {
  return new Request("https://synthetic.test/api/analytics/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "Synthetic plant", filters, mode: "answer" }),
  });
}
function completion(answer: string) {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: answer }] }, finishReason: "STOP" }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearGeminiModelCooldowns();
  state.transactionDepth = 0;
  state.active = true;
  state.chunkAvailable = true;
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "synthetic-key");
  vi.stubEnv("AI_CHAT_MODEL", "gemini-3.8-flash");
  vi.stubEnv("AI_LIGHT_MODEL", "gemini-3.5-flash-lite");
  vi.stubEnv("GEMINI_EMBED_MODEL", "gemini-embedding-2");
  vi.stubEnv("ENABLE_RERANK", "true");
  for (const name of ["info", "warn", "error"] as const)
    vi.spyOn(console, name).mockImplementation(() => {});
  state.query.mockImplementation(async (query: string) => {
    if (query.startsWith('select "clearance" from "app_users"'))
      return { rows: state.active ? [[state.classification]] : [] };
    if (query.startsWith('select "id", "clearance" from "app_users"'))
      return { rows: state.active ? [[user.id, state.classification]] : [] };
    if (query.includes('from "chunks" left join'))
      return {
        rows: [
          [
            chunkId,
            chunkId,
            "document",
            documentId,
            null,
            "Synthetic plant",
            "2026-10-01",
            null,
            "OSINT",
            "Output",
            text,
            0,
            text.length,
            false,
            "A",
            1,
            state.classification,
          ],
        ],
      };
    if (query.includes('from "chunks"'))
      return {
        rows: state.chunkAvailable ? [[chunkId, documentId, null, text, 0, text.length]] : [],
      };
    if (query.includes('from "documents"')) return { rows: [[documentId, state.classification]] };
    if (query.includes('from "attachments"')) return { rows: [] };
    throw new Error("Unexpected synthetic SQL shape.");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearGeminiModelCooldowns();
});

function mockProvider(onDispatch?: (stage: string) => void) {
  const stages: string[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    // Exercise real search, authorization, provider adapters and endpoint, never a live service.
    expect(state.transactionDepth).toBe(0);
    const body = String(init?.body);
    const stage = String(url).includes("embedContent")
      ? "embedding"
      : body.includes("Rank candidate excerpts")
        ? "rerank"
        : "generation";
    stages.push(stage);
    onDispatch?.(stage);
    if (stage === "embedding") return Response.json({ embedding: { values: vector } });
    if (stage === "rerank") return completion(JSON.stringify({ ids: [chunkId] }));
    expect(body).toContain(text);
    expect(body).not.toMatch(/Material qrupu|\bM\d+\b/u);
    return completion("Synthetic result: 42 units [1].");
  });
  vi.stubGlobal("fetch", fetch);
  return { stages, fetch };
}

describe("authorized RAG without classification-based AI gates or network-held DB locks", () => {
  it.each(
    (["open", "secret", "top_secret", "special"] as const).flatMap((clearance) =>
      [false, true].map((enabled) => ({ clearance, enabled })),
    ),
  )(
    "runs embedding, enabled rerank and generation for $clearance sources (context=$enabled)",
    async ({ clearance, enabled }) => {
      vi.stubEnv("ENABLE_CONTEXT_EXPANSION", String(enabled));
      state.classification = clearance;
      const { stages, fetch } = mockProvider();
      const response = await withCurrentUser({ ...user, clearance }, () =>
        handleAnalyticsSearchRequest(request()),
      );
      const output = await response.text();
      expect(stages).toEqual(["embedding", "rerank", "generation"]);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(output).toContain('"type":"final"');
      expect(output).not.toContain('"type":"error"');
      expect(state.saveHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: "done",
          answer: "Synthetic result: 42 units [1].",
          maxClassification: clearance,
        }),
      );
      const sql = state.query.mock.calls.map(([query]) => query).join(" ");
      expect(sql).toContain('"chunks"."embedding_model"');
      expect(sql).toContain('"app_users"."active" = true');
      expect(sql).toContain('"app_users"."clearance"');
      expect(state.transactionDepth).toBe(0);
    },
  );

  it.each(["rerank", "generation"])(
    "fails closed when an index is replaced during %s",
    async (stage) => {
      state.classification = "open";
      const { stages } = mockProvider((current) => {
        if (current === stage) state.chunkAvailable = false;
      });
      const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
      const output = await response.text();
      expect(output).not.toContain('"type":"final"');
      expect(output).not.toContain("Synthetic result");
      if (stage === "rerank") expect(stages).toEqual(["embedding", "rerank"]);
      else expect(stages).toEqual(["embedding", "rerank", "generation"]);
      expect(state.saveHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "failed" }),
      );
      expect(state.transactionDepth).toBe(0);
    },
  );

  it("does not send query text after an entry-clearance downgrade", async () => {
    state.classification = "open";
    const { fetch } = mockProvider();
    const response = await withCurrentUser({ ...user, clearance: "secret" }, () =>
      handleAnalyticsSearchRequest(request()),
    );
    expect(response.status).toBe(200);
    const output = await response.text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('"type":"sources"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not publish after the account is deactivated during generation", async () => {
    state.classification = "open";
    mockProvider((stage) => {
      if (stage === "generation") state.active = false;
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('"type":"final"');
    expect(state.saveHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", answer: "", sources: [] }),
    );
  });
});
