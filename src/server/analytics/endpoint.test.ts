import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  generate: vi.fn(),
  updateHistory: vi.fn(async (_id: string, _value: unknown) => undefined),
  createHistory: vi.fn(async (_value: unknown) => undefined),
}));

vi.mock("./rate-limit", () => ({ consumeAnalyticsRateLimit: vi.fn(async () => true) }));
vi.mock("./search", () => ({ searchDocumentChunks: mocks.search }));
vi.mock("./history", () => ({
  buildAnalyticsHistorySnapshot: vi.fn(() => ({ snapshots: [], maxClassification: "open" })),
  createAnalyticsHistoryRecord: mocks.createHistory,
  updateAnalyticsHistoryRecord: mocks.updateHistory,
}));
vi.mock("@/server/ai/gemini", () => ({
  createGeminiProviders: () => ({
    analytics: { model: "test-model", generateTextWithMetadata: mocks.generate },
  }),
}));
vi.mock("@/server/ai/gemini-gateway", () => ({
  getGeminiFailureInfo: () => ({}),
  isGeminiQuotaError: () => false,
}));
vi.mock("@/server/config", () => ({ getAppConfig: () => ({ analyticsThinkingLevel: "low" }) }));
vi.mock("../prompts/analytics", () => ({
  buildAnalyticsPrompt: () => ({ system: "system", prompt: "prompt", maxOutputTokens: 100 }),
}));
vi.mock("./citations", () => ({
  canPublishAnalyticsAnswer: () => true,
  validateCitations: (answer: string) => ({ answer, incomplete: false, citations: [] }),
}));

import { directionIds } from "@/lib/directions";
import { withCurrentUser, type SessionUser } from "@/server/auth";
import { handleAnalyticsSearchRequest } from "./endpoint";

const user: SessionUser = {
  id: "analytics-user",
  username: "analyst",
  role: "user",
  clearance: "secret",
  sessionId: "session",
};
const filters = {
  period: "all",
  tag: "",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};

const source = {
  sourceKind: "document" as const,
  n: 1,
  chunkId: "chunk-1",
  documentId: "00000000-0000-4000-8000-000000000001",
  briefId: null,
  title: "Title",
  docDate: null,
  briefDate: null,
  direction: "OSINT",
  sectionTitle: "Section",
  text: "evidence text",
  quote: "evidence text",
  charStart: 0,
  charEnd: 13,
  isTable: false,
  attachmentCount: 0,
  tags: [],
  sourceReliability: "A" as const,
  infoCredibility: 1 as const,
  classification: "open",
};

function request(signal?: AbortSignal) {
  return new Request("https://app.example.test/api/analytics/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "question", filters, mode: "answer" }),
    ...(signal ? { signal } : {}),
  });
}

describe("analytics stream cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue([source]);
    mocks.generate.mockResolvedValue({ text: "answer [1]", finishReason: "stop" });
  });

  it("aborts retrieval providers when the request disconnects", async () => {
    let providerSignal: AbortSignal | undefined;
    mocks.search.mockImplementation((_query, _filters, options: { signal: AbortSignal }) => {
      providerSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });
    const client = new AbortController();
    const pending = withCurrentUser(user, () =>
      handleAnalyticsSearchRequest(request(client.signal)),
    );
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    client.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(providerSignal?.aborted).toBe(true);
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("aborts answer generation and marks history cancelled when the stream is cancelled", async () => {
    let providerSignal: AbortSignal | undefined;
    mocks.generate.mockImplementation((input: { signal: AbortSignal }) => {
      providerSignal = input.signal;
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    await reader.cancel();
    await vi.waitFor(() =>
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "cancelled" }),
      ),
    );
    expect(providerSignal?.aborted).toBe(true);
  });
});
