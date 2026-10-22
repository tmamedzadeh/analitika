import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSource } from "@/lib/analytics";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  generate: vi.fn(),
  buildPrompt: vi.fn(),
  withSourceAccess: vi.fn(
    async (
      sources: readonly AnalyticsSource[],
      _userId: string,
      publish: (available: AnalyticsSource[], queryClassification: string) => unknown,
    ) => {
      const available = [...sources];
      return { sources: available, value: await publish(available, "open") };
    },
  ),
  updateHistory: vi.fn(async (_id: string, _value: unknown) => undefined),
  createHistory: vi.fn(async (_value: unknown) => undefined),
}));

vi.mock("./rate-limit", () => ({ consumeAnalyticsRateLimit: vi.fn(async () => true) }));
vi.mock("./search", () => ({ searchDocumentChunks: mocks.search }));
vi.mock("./source-access", () => ({
  withAnalyticsSourceAccess: mocks.withSourceAccess,
  sameAnalyticsSourceSet: (
    expected: readonly AnalyticsSource[],
    actual: readonly AnalyticsSource[],
  ) =>
    expected.length === actual.length &&
    expected.every((source) => actual.some((candidate) => candidate.chunkId === source.chunkId)),
}));
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
  buildAnalyticsPrompt: mocks.buildPrompt,
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

describe("analytics stream access and cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue([source]);
    mocks.generate.mockResolvedValue({ text: "answer [1]", finishReason: "stop" });
    mocks.buildPrompt.mockReturnValue({ system: "system", prompt: "prompt", maxOutputTokens: 100 });
    mocks.withSourceAccess.mockImplementation(async (sources, _userId, publish) => {
      const available = [...sources];
      return { sources: available, value: await publish(available, "open") };
    });
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

  it("withholds the answer and clears history if source access changes during generation", async () => {
    const availableByCheck = [[source], [source], []] as const;
    let index = 0;
    mocks.withSourceAccess.mockImplementation(async (_sources, _userId, publish) => {
      const available = [...(availableByCheck[index++] ?? [])];
      return { sources: available, value: await publish(available, "open") };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const reader = response.body!.getReader();
    const output: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output.push(new TextDecoder().decode(value));
    }
    const stream = output.join("");
    expect(stream).toContain('"type":"error"');
    expect(stream).not.toContain("answer [1]");
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", answer: "", sources: [] }),
    );
  });

  it.each(["open", "secret", "top_secret", "special"] as const)(
    "generates from authorized sources for %s clearance and classification",
    async (clearance) => {
      const classifiedSource = { ...source, classification: clearance };
      mocks.search.mockResolvedValue([classifiedSource]);
      mocks.withSourceAccess.mockImplementation(async (sources, _userId, publish) => {
        const available = [...sources];
        return { sources: available, value: await publish(available, clearance) };
      });

      const response = await withCurrentUser({ ...user, clearance }, () =>
        handleAnalyticsSearchRequest(request()),
      );
      const stream = await response.text();

      expect(stream).toContain('"type":"final"');
      expect(stream).toContain("answer [1]");
      expect(stream).not.toContain('"type":"error"');
      expect(mocks.generate).toHaveBeenCalledOnce();
      expect(mocks.buildPrompt).toHaveBeenCalledWith("question", [classifiedSource], "low");
    },
  );

  it.each([false, true])(
    "excludes denied sources before Gemini dispatch (all denied: %s)",
    async (allDenied) => {
      const denied = { ...source, chunkId: "denied-chunk", text: "inaccessible source text" };
      mocks.search.mockResolvedValue([source, denied]);
      mocks.withSourceAccess.mockImplementation(async (_sources, _userId, publish) => {
        const available = allDenied ? [] : [source];
        return { sources: available, value: await publish(available, "secret") };
      });

      const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
      const stream = await response.text();

      expect(stream).toContain('"type":"final"');
      expect(stream).not.toContain(denied.text);
      if (allDenied) {
        expect(mocks.generate).not.toHaveBeenCalled();
        expect(mocks.buildPrompt).not.toHaveBeenCalled();
      } else {
        expect(mocks.generate).toHaveBeenCalledOnce();
        expect(mocks.buildPrompt).toHaveBeenCalledWith("question", [source], "low");
      }
    },
  );
});
