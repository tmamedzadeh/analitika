import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSource } from "@/lib/analytics";
import { ANALYTICS_SERVER_DEADLINE_MS } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";

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
      return { sources: available, value: await publish(available, "secret") };
    },
  ),
  updateHistory: vi.fn(async (_id: string, _value: unknown) => undefined),
  createHistory: vi.fn(async (_value: unknown): Promise<void> => undefined),
}));

vi.mock("./rate-limit", () => ({ consumeAnalyticsRateLimit: vi.fn(async () => true) }));
vi.mock("./search", () => ({ searchDocumentChunks: mocks.search }));
vi.mock("./source-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./source-access")>();
  return {
    ...actual,
    withAnalyticsSourceAccess: mocks.withSourceAccess,
    requireAnalyticsSourceAccess: async (sources: AnalyticsSource[], user: SessionUser) => {
      const result = await mocks.withSourceAccess(sources, user.id, (available, clearance) => {
        actual.assertAnalyticsQuestionAccess(user, clearance);
        if (!actual.sameAnalyticsSourceSet(sources, available)) throw new AuthorizationError();
        return available;
      });
      return result.value;
    },
  };
});
vi.mock("./history", () => ({
  buildAnalyticsHistorySnapshot: vi.fn(() => ({ snapshots: [], maxClassification: "open" })),
  createAnalyticsHistoryRecord: mocks.createHistory,
  updateAnalyticsHistoryRecord: mocks.updateHistory,
}));
vi.mock("@/server/ai/gemini", () => ({
  createGeminiProviders: () => ({
    analytics: {
      model: "test-model",
      generateTextWithMetadata: async (input: TextGenerationInput) => {
        await input.beforeRequest?.();
        return mocks.generate(input);
      },
    },
  }),
}));
vi.mock("@/server/config", () => ({ getAppConfig: () => ({ analyticsThinkingLevel: "low" }) }));
vi.mock("../prompts/analytics", () => ({
  buildAnalyticsPrompt: mocks.buildPrompt,
}));
import { directionIds } from "@/lib/directions";
import { AuthorizationError, withCurrentUser, type SessionUser } from "@/server/auth";
import type { TextGenerationInput } from "@/server/ai/types";
import { handleAnalyticsSearchRequest } from "./endpoint";
import { consumeAnalyticsRateLimit } from "./rate-limit";
import { EvidenceContextBudgetError } from "./evidence-selection";

const user: SessionUser = {
  id: "analytics-user",
  username: "analyst",
  role: "user",
  clearance: "secret",
  sessionId: "session",
};
const filters = {
  period: "30d",
  includeBriefs: false,
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

function request(signal?: AbortSignal, mode: "answer" | "sources" = "answer") {
  return new Request("https://app.example.test/api/analytics/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "question", filters, mode }),
    ...(signal ? { signal } : {}),
  });
}

function streamEvents(stream: string): Record<string, unknown>[] {
  return stream
    .split(/\r?\n\r?\n/)
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)));
}

function timeoutDiagnostics(): Record<string, unknown>[] {
  return vi
    .mocked(console.error)
    .mock.calls.map(([message]) => JSON.parse(String(message).replace("[analytics-ai] ", "")))
    .filter((event) => event.errorCategory === "timeout");
}

describe("analytics stream access and cancellation", () => {
  it("rechecks the budget if authorization removes the original owner of duplicated text", async () => {
    const text = source.text.replace(" ", " ".repeat(25_000));
    const copy = {
      ...source,
      n: 2,
      chunkId: "chunk-2",
      documentId: "00000000-0000-4000-8000-000000000002",
      text,
      charEnd: text.length,
    };
    mocks.search.mockResolvedValueOnce([source, copy]);
    mocks.withSourceAccess.mockImplementationOnce(async (_sources, _userId, publish) => {
      const available = [{ ...copy, n: 1 }];
      return { sources: available, value: await publish(available, "secret") };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain('"code":"evidence_context_budget_exceeded"');
    expect(output).not.toContain('"type":"sources"');
    expect(output).not.toContain('"type":"final"');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", sources: [], answer: "" }),
    );
  });
  it.each(["answer", "sources"] as const)(
    "reports oversized evidence safely in %s mode without generation or a no-sources answer",
    async (mode) => {
      mocks.search.mockRejectedValueOnce(new EvidenceContextBudgetError());
      const response = await withCurrentUser(user, () =>
        handleAnalyticsSearchRequest(request(undefined, mode)),
      );
      const output = await response.text();
      expect(output).toContain('"code":"evidence_context_budget_exceeded"');
      expect(output).toContain(az.analytics.evidenceTooLarge);
      expect(output).not.toContain(az.analytics.noSources);
      expect(output).not.toContain('"type":"final"');
      expect(output).not.toContain('"type":"sources"');
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.buildPrompt).not.toHaveBeenCalled();
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "failed" }),
      );
    },
  );

  it("retains the normal no-sources response for an actually empty authorized search", async () => {
    mocks.search.mockResolvedValueOnce([]);
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain(az.analytics.noSources);
    expect(output).toContain('"type":"final"');
    expect(output).not.toContain("evidence_context_budget_exceeded");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "done", answer: az.analytics.noSources }),
    );
  });
  it("returns a localized unavailable error and failed history when the provider route fails with 503", async () => {
    mocks.generate.mockRejectedValueOnce(
      Object.assign(new Error("private provider details"), { statusCode: 503 }),
    );
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const stream = await response.text();
    expect(stream).toContain(az.analytics.providerUnavailable);
    expect(stream).not.toContain('"type":"final"');
    expect(stream).not.toContain("private provider details");
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });
  it.each([
    [429, az.analytics.quotaExceeded, "quota"],
    [503, az.analytics.providerUnavailable, "provider_unavailable"],
    [504, az.analytics.answerFailed, "provider_transient"],
    [400, az.analytics.answerFailed, "provider_request"],
  ] as const)(
    "does not relabel provider HTTP %s as the overall deadline",
    async (statusCode, message, category) => {
      mocks.generate.mockRejectedValueOnce(
        Object.assign(new Error("private provider details"), { statusCode }),
      );
      const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
      const output = await response.text();
      expect(output).toContain(message);
      expect(output).not.toContain('"code":"timeout"');
      expect(timeoutDiagnostics()).toEqual([]);
      expect(vi.mocked(console.error).mock.calls.join(" ")).toContain(
        `"errorCategory":"${category}"`,
      );
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "failed" }),
      );
    },
  );
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
      return { sources: available, value: await publish(available, "secret") };
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
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('"type":"final"');
    expect(providerSignal?.aborted).toBe(true);
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("opens SSE before retrieval resolves and publishes only real ordered milestones", async () => {
    let finish!: (value: AnalyticsSource[]) => void;
    mocks.search.mockImplementationOnce(
      () =>
        new Promise<AnalyticsSource[]>((resolve) => {
          finish = resolve;
        }),
    );
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let output = decoder.decode((await reader.read()).value);
    output += decoder.decode((await reader.read()).value);
    expect(output).toContain('"stage":"retrieval"');
    expect(output).not.toContain('"type":"sources"');
    expect(mocks.generate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish([source]);
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      output += decoder.decode(part.value);
    }
    const events = output
      .trim()
      .split("\n\n")
      .map((frame) => JSON.parse(frame.slice(6)));
    expect(
      events.map((event) => (event["type"] === "progress" ? event.stage : event["type"])),
    ).toEqual(["starting", "retrieval", "sources", "sources", "generation", "validation", "final"]);
    expect(
      events
        .filter((event) => event["type"] === "progress")
        .every((event) => Object.keys(event).sort().join() === "stage,type"),
    ).toBe(true);
    expect(mocks.search).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it.each(["empty", "sources"])(
    "skips nonexistent generation stages for %s results",
    async (scenario) => {
      if (scenario === "empty") mocks.search.mockResolvedValueOnce([]);
      const response = await withCurrentUser(user, () =>
        handleAnalyticsSearchRequest(
          request(undefined, scenario === "sources" ? "sources" : "answer"),
        ),
      );
      const output = await response.text();
      expect(output).toContain('"type":"final"');
      expect(output).not.toContain('"stage":"generation"');
      expect(output).not.toContain('"stage":"validation"');
      expect(mocks.generate).not.toHaveBeenCalled();
    },
  );

  it("returns validation to generation for the existing retry without publishing the draft", async () => {
    mocks.generate.mockResolvedValueOnce({ text: "PRIVATE_DRAFT [1]", finishReason: "length" });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    const stages = [...output.matchAll(/"type":"progress","stage":"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(stages).toEqual([
      "starting",
      "retrieval",
      "sources",
      "generation",
      "validation",
      "generation",
      "validation",
    ]);
    expect(output).not.toContain("PRIVATE_DRAFT");
    expect((output.match(/"type":"final"/g) ?? []).length).toBe(1);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
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

  it("does not retry or publish a late provider completion after client cancellation", async () => {
    let complete: ((value: { text: string; finishReason: string }) => void) | undefined;
    mocks.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(complete).toBeDefined());
    await reader.cancel();
    complete!({ text: "late private answer [1]", finishReason: "length" });
    await vi.waitFor(() =>
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "cancelled" }),
      ),
    );
    // Let the provider's ignored-abort promise settle before checking attempts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "done" }),
    );
  });

  it.each(["answer", "sources"] as const)(
    "revokes %s publication after a clearance downgrade even when open sources remain accessible",
    async (mode) => {
      let check = 0;
      mocks.withSourceAccess.mockImplementation(async (sources, _userId, publish) => {
        const available = [...sources];
        const clearance = ++check < (mode === "answer" ? 3 : 2) ? "secret" : "open";
        return { sources: available, value: await publish(available, clearance) };
      });
      const response = await withCurrentUser(user, () =>
        handleAnalyticsSearchRequest(request(undefined, mode)),
      );
      const stream = await response.text();
      expect(stream).toContain('"type":"error"');
      expect(stream).not.toContain('"type":"final"');
      expect(stream).not.toContain("answer [1]");
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "failed", answer: "", sources: [] }),
      );
    },
  );

  it("does not send a classified question to Gemini after an account clearance downgrade", async () => {
    mocks.withSourceAccess.mockImplementation(async (sources, _userId, publish) => {
      const available = [...sources];
      return { sources: available, value: await publish(available, "open") };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const stream = await response.text();
    expect(stream).toContain('"type":"error"');
    expect(stream).not.toContain(source.quote);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.buildPrompt).not.toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    const stream = await output;

    expect(response.status).toBe(200);
    expect(stream).toContain('"type":"error"');
    expect(stream).toContain(response.headers.get("x-analytics-request-id"));
    expect(stream).not.toContain('"type":"final"');
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error).mock.calls.join(" ")).toContain('"errorCategory":"timeout"');
    expect(streamEvents(stream).filter((event) => event["type"] === "error")).toEqual([
      {
        type: "error",
        code: "timeout",
        message: az.analytics.timeout,
        requestId: response.headers.get("x-analytics-request-id"),
      },
    ]);
    expect(timeoutDiagnostics()).toEqual([
      expect.objectContaining({
        requestId: response.headers.get("x-analytics-request-id"),
        stage: "generation",
        model: "test-model",
        generationAttempt: 1,
        elapsedMs: 240_000,
        errorCategory: "timeout",
        timeoutScope: "overall",
        outcome: "failed",
        providerStatus: null,
      }),
    ]);
    expect(timeoutDiagnostics()[0]).not.toHaveProperty("finishReason");
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", durationMs: 240_000 }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes after the former 105-second deadline within the shared 240-second budget", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    mocks.search.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 18_019));
      return [source];
    });
    mocks.generate.mockImplementationOnce((input: TextGenerationInput) => {
      expect(input.timeoutMs).toBeUndefined();
      expect(input.deadlineAt).toBe(startedAt + 240_000);
      return new Promise((resolve) =>
        setTimeout(() => resolve({ text: "answer [1]", finishReason: "stop" }), 120_000),
      );
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = response.text();
    await vi.advanceTimersByTimeAsync(105_000);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).not.toHaveBeenCalled();
    expect(timeoutDiagnostics()).toEqual([]);
    await vi.advanceTimersByTimeAsync(33_019);
    const events = streamEvents(await output);
    expect(events.filter((event) => event["type"] === "final")).toEqual([
      expect.objectContaining({ answer: "answer [1]", durationMs: 138_019 }),
    ]);
    expect(events.some((event) => event["type"] === "error")).toBe(false);
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "done", durationMs: 138_019 }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["provider-first", "server-first"] as const)(
    "sends one overall timeout when timers share the deadline (%s)",
    async (order) => {
      vi.useFakeTimers();
      let rejectProvider!: (reason: unknown) => void;
      const providerTimeout = () =>
        rejectProvider(
          new Error("private provider wrapper", {
            cause: new DOMException("private provider body", "TimeoutError"),
          }),
        );
      if (order === "provider-first") setTimeout(providerTimeout, 240_000);
      mocks.generate.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectProvider = reject;
          }),
      );
      const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
      const output = response.text();
      await vi.advanceTimersByTimeAsync(0);
      if (order === "server-first") setTimeout(providerTimeout, 240_000);
      await vi.advanceTimersByTimeAsync(239_999);
      expect(timeoutDiagnostics()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      const events = streamEvents(await output);
      expect(events.filter((event) => ["error", "final"].includes(String(event["type"])))).toEqual([
        expect.objectContaining({ type: "error", code: "timeout", message: az.analytics.timeout }),
      ]);
      expect(timeoutDiagnostics()).toEqual([
        expect.objectContaining({
          timeoutScope: "overall",
          outcome: "failed",
          generationAttempt: 1,
        }),
      ]);
      expect(mocks.updateHistory).toHaveBeenCalledOnce();
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "failed" }),
      );
      expect(mocks.generate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(JSON.stringify(timeoutDiagnostics())).not.toContain("private");
    },
  );

  it("distinguishes an early provider timeout from the overall deadline", async () => {
    vi.useFakeTimers();
    mocks.generate.mockRejectedValueOnce(
      new DOMException("private provider failure", "TimeoutError"),
    );
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const events = streamEvents(await response.text());
    expect(events.filter((event) => event["type"] === "error")).toEqual([
      expect.objectContaining({ code: "timeout", message: az.analytics.timeout }),
    ]);
    expect(timeoutDiagnostics()).toEqual([
      expect.objectContaining({ event: "failure", timeoutScope: "model", outcome: "failed" }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records the active fallback model and validation retry on deadline without source content", async () => {
    vi.useFakeTimers();
    mocks.generate.mockResolvedValueOnce({
      text: "private incomplete draft",
      finishReason: "length",
    });
    mocks.generate.mockImplementationOnce((input: TextGenerationInput) => {
      input.onFallback?.({
        fromModel: "test-model",
        toModel: "fallback-model",
        reason: "quota",
        backup: false,
      });
      return new Promise(() => {});
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = response.text();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(await output).toContain('"code":"timeout"');
    expect(timeoutDiagnostics()).toEqual([
      expect.objectContaining({
        model: "fallback-model",
        generationAttempt: 2,
        stage: "generation",
      }),
    ]);
    const logs = JSON.stringify(timeoutDiagnostics());
    for (const secret of [
      "private incomplete draft",
      source.text,
      source.quote,
      "question",
      "prompt",
      "system",
    ])
      expect(logs).not.toContain(secret);
    expect(timeoutDiagnostics()[0]).not.toHaveProperty("finishReason");
  });

  it("ignores a provider completion after the deadline and keeps failed history", async () => {
    vi.useFakeTimers();
    let finish!: (value: { text: string; finishReason: string }) => void;
    mocks.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = response.text();
    await vi.advanceTimersByTimeAsync(240_000);
    const stream = await output;
    finish({ text: "late private answer [1]", finishReason: "stop" });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      streamEvents(stream).filter((event) => ["error", "final"].includes(String(event["type"]))),
    ).toEqual([expect.objectContaining({ type: "error", code: "timeout" })]);
    expect(stream).not.toContain("late private answer");
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses a late completion even when the deadline timer has not run", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    mocks.generate.mockImplementationOnce(async () => {
      vi.setSystemTime(startedAt + 240_001);
      return { text: "late private answer [1]", finishReason: "stop" };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain('"code":"timeout"');
    expect(output).not.toContain('"type":"final"');
    expect(output).not.toContain("late private answer");
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["AbortError", "TimeoutError"])(
    "keeps client cancellation distinct from server timeout (%s)",
    async (name) => {
      vi.useFakeTimers();
      const client = new AbortController();
      mocks.generate.mockImplementationOnce(() => new Promise(() => {}));
      const response = await withCurrentUser(user, () =>
        handleAnalyticsSearchRequest(request(client.signal)),
      );
      const output = response.text();
      await vi.advanceTimersByTimeAsync(0);
      client.abort(new DOMException("client stopped", name));
      expect(await output).not.toContain('"type":"error"');
      expect(timeoutDiagnostics()).toEqual([]);
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "cancelled" }),
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("enforces the overall deadline when retrieval ignores its abort signal", async () => {
    vi.useFakeTimers();
    mocks.search.mockImplementation(() => new Promise(() => {}));
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"error"');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("includes a stalled rate-limit DB read in the absolute deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(consumeAnalyticsRateLimit).mockImplementationOnce(() => new Promise(() => {}));
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      code: "timeout",
      message: az.analytics.timeout,
      requestId: response.headers.get("x-analytics-request-id"),
    });
    expect(timeoutDiagnostics()).toEqual([
      expect.objectContaining({
        stage: "retrieval",
        model: null,
        generationAttempt: null,
        elapsedMs: 240_000,
        timeoutScope: "overall",
        outcome: "failed",
        providerStatus: null,
      }),
    ]);
    expect(timeoutDiagnostics()[0]).not.toHaveProperty("finishReason");
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.createHistory).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("times out request body parsing before opening SSE", async () => {
    vi.useFakeTimers();
    const input = request();
    vi.spyOn(input, "json").mockImplementationOnce(() => new Promise(() => {}));
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(input));
    await vi.advanceTimersByTimeAsync(240_000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      code: "timeout",
      message: az.analytics.timeout,
      requestId: response.headers.get("x-analytics-request-id"),
    });
    expect(mocks.createHistory).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(timeoutDiagnostics()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates SSE even when the provider ignores cancellation", async () => {
    vi.useFakeTimers();
    mocks.generate.mockImplementation(() => new Promise(() => {}));
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = response.text();
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    expect(await output).toContain('"type":"error"');
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("finishes a validated SSE response within budget when terminal history persistence stalls", async () => {
    vi.useFakeTimers();
    mocks.updateHistory.mockImplementationOnce(() => new Promise<undefined>(() => {}));
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = response.text();
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    const stream = await output;
    expect(stream).toContain('"type":"final"');
    expect(stream).not.toContain('"type":"error"');
    expect(mocks.updateHistory).toHaveBeenCalledOnce();
    expect(timeoutDiagnostics()).toEqual([]);
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "done" }),
    );
  });

  it("finalizes a history insert that completes after the request deadline", async () => {
    vi.useFakeTimers();
    let inserted!: () => void;
    mocks.createHistory.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          inserted = resolve;
        }),
    );
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"error"');
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.updateHistory).not.toHaveBeenCalled();
    inserted();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", durationMs: ANALYTICS_SERVER_DEADLINE_MS }),
    );
  });

  it("rejects a validation retry if a source was replaced after the first completion", async () => {
    let revoked = false;
    mocks.withSourceAccess.mockImplementation(async (sources, _id, publish) => {
      const available = revoked ? [] : [...sources];
      return { sources: available, value: publish(available, "secret") };
    });
    mocks.generate.mockImplementationOnce(async () => {
      revoked = true;
      return { text: "unpublishable private draft", finishReason: "length" };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain("private draft");
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", sources: [], answer: "" }),
    );
  });

  it("rechecks question access before a no-sources final response", async () => {
    mocks.search.mockResolvedValue([]);
    let checks = 0;
    mocks.withSourceAccess.mockImplementation(async (sources, _id, publish) => ({
      sources: [...sources],
      value: publish([...sources], ++checks === 1 ? "secret" : "open"),
    }));
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const output = await response.text();
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('"type":"final"');
  });

  it("retains done history when disconnect follows a final event before lock release", async () => {
    let checks = 0;
    let release!: () => void;
    mocks.withSourceAccess.mockImplementation(async (sources, _id, publish) => {
      const available = [...sources];
      const value = publish(available, "secret");
      if (++checks === 3)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { sources: available, value };
    });
    const response = await withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    const reader = response.body!.getReader();
    let frame = "";
    while (!frame.includes('"type":"final"')) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      frame = new TextDecoder().decode(chunk.value);
    }
    await reader.cancel();
    release();
    await vi.waitFor(() =>
      expect(mocks.updateHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "done", answer: "answer [1]" }),
      ),
    );
    expect(mocks.updateHistory).toHaveBeenCalledOnce();
  });

  it("allows 75-second reasoning after retrieval without a 60-second generation cap", async () => {
    vi.useFakeTimers();
    mocks.search.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      return [source];
    });
    mocks.generate.mockImplementation((input: { timeoutMs?: number; deadlineAt: number }) => {
      expect(input.timeoutMs).toBeUndefined();
      expect(input.deadlineAt - Date.now()).toBe(ANALYTICS_SERVER_DEADLINE_MS - 11_000);
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              text: "Synthetic answer [1]",
              finishReason: "stop",
              model: "long-reasoning-model",
            }),
          75_000,
        ),
      );
    });
    const pending = withCurrentUser(user, () => handleAnalyticsSearchRequest(request()));
    await vi.advanceTimersByTimeAsync(11_000);
    const response = await pending;
    const output = response.text();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.updateHistory).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await output).toContain('"type":"final"');
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "done",
        durationMs: 86_000,
        model: "long-reasoning-model",
      }),
    );
  });

  it("includes history setup time in the 240-second overall budget", async () => {
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
    await vi.advanceTimersByTimeAsync(ANALYTICS_SERVER_DEADLINE_MS - 20_000);
    expect(await output).toContain('"type":"error"');
    expect(mocks.updateHistory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", durationMs: ANALYTICS_SERVER_DEADLINE_MS }),
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
