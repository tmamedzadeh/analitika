import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/server/config", () => ({ getAppConfig: () => ({ analyticsThinkingLevel: "low" }) }));
vi.mock("../prompts/analytics", () => ({
  buildAnalyticsPrompt: mocks.buildPrompt,
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
  it("sends backend fallback events and persists the actual completing model", async () => {
    mocks.generate.mockImplementation(async (input) => {
      input.onFallback({
        fromModel: "gemini-3.8-flash",
        toModel: "gemini-3.1-flash-lite",
        reason: "quota",
        backup: true,
      });
      return { text: "answer [1]", finishReason: "stop", model: "gemini-3.1-flash-lite" };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain('"type":"model-fallback"');
    expect(output).toContain('"model":"gemini-3.1-flash-lite"');
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: "gemini-3.1-flash-lite", status: "done" }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.search.mockResolvedValue([source]);
    mocks.generate.mockResolvedValue({ text: "answer [1]", finishReason: "stop" });
    mocks.buildPrompt.mockReturnValue({
      system: "system",
      prompt: "prompt",
      maxOutputTokens: 100,
    });
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

  it("sends a terminal SSE error with requestId when the overall deadline expires", async () => {
    vi.useFakeTimers();
    mocks.generate.mockImplementation(
      (input: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        }),
    );
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = response.text();
    await vi.advanceTimersByTimeAsync(105_000);
    const stream = await output;

    expect(response.status).toBe(200);
    expect(stream).toContain('"type":"error"');
    expect(stream).toContain(response.headers.get("x-analytics-request-id"));
    expect(stream).not.toContain('"type":"final"');
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error).mock.calls.join(" ")).toContain('"errorCategory":"timeout"');
  });

  it("distinguishes a 60-second generation timeout after 11 seconds of retrieval", async () => {
    vi.useFakeTimers();
    mocks.search.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      return [source];
    });
    mocks.generate.mockImplementation(
      (input: { timeoutMs: number }) =>
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new DOMException("sensitive provider details", "TimeoutError")),
            input.timeoutMs,
          ),
        ),
    );
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    await vi.advanceTimersByTimeAsync(11_000);
    const response = await pending;
    const output = response.text();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await output).toContain('"type":"error"');
    expect(mocks.generate).toHaveBeenCalledOnce();
    const logs = vi.mocked(console.error).mock.calls.join(" ");
    expect(logs).toContain('"stage":"generation"');
    expect(logs).toContain('"attempt":1');
    expect(logs).toContain('"errorCategory":"timeout"');
    expect(logs).toContain('"elapsedMs":71000');
    expect(logs).not.toContain("sensitive provider details");
  });

  it("includes history setup time in the 105-second overall budget", async () => {
    vi.useFakeTimers();
    mocks.createHistory.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    });
    mocks.generate.mockImplementation(
      (input: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        }),
    );
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;
    const output = response.text();
    await vi.advanceTimersByTimeAsync(85_000);
    expect(await output).toContain('"type":"error"');
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", durationMs: 105_000 }),
    );
  });

  it("retries length-limited output once and publishes only the validated completion", async () => {
    mocks.generate.mockResolvedValueOnce({
      text: "private truncated output",
      finishReason: "length",
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const stream = await response.text();

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[1]?.[0]).toMatchObject({ maxOutputTokens: 6144 });
    expect(stream).toContain('"type":"final"');
    expect(stream).not.toContain("private truncated output");
    const logs = vi.mocked(console.warn).mock.calls.join(" ");
    expect(logs).toContain('"finishReason":"length"');
    expect(logs).toContain("non_stop_finish");
    expect(logs).not.toContain("private truncated output");
  });

  it("withholds both invalid completions and logs only validation reason codes", async () => {
    mocks.generate.mockResolvedValue({ text: "private answer [99]", finishReason: "stop" });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const stream = await response.text();

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(stream).toContain('"type":"error"');
    expect(stream).not.toContain('"type":"final"');
    const logs = vi.mocked(console.warn).mock.calls.join(" ");
    expect(logs).toContain('"attempt":2');
    expect(logs).toContain('"errorCategory":"validation"');
    expect(logs).toContain("unknown_citation");
    for (const secret of ["private answer", source.text, "question"])
      expect(logs).not.toContain(secret);
  });

  it("publishes a normal RAG summary on the first attempt without internal evidence markers", async () => {
    const answer =
      "## Qısa nəticə\n1. Şirkət investisiya elan etdi. Layihənin başlanğıcı 2026-cı ildir [1].\n\nDigər istiqamətlər barədə məlumat kifayət etmir.";
    mocks.generate.mockResolvedValue({ text: answer, finishReason: "stop" });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const stream = await response.text();

    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(stream).toContain('"type":"final"');
    expect(stream).not.toContain('"type":"error"');
    expect(stream).toContain(JSON.stringify(answer));
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "done", answer }),
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
