import { describe, expect, it } from "vitest";

import {
  buildOsintDiagnostics,
  errorClassForFailure,
  mergeRetryDiagnostics,
  osintDiagnosticsFor,
  type OsintDiagnostics,
} from "./diagnostics";
import type { SummaryStatus } from "./reports";

const createdAt = new Date("2026-10-20T10:00:00.000Z");
const finishedAt = new Date("2026-10-20T10:01:30.500Z");

type DiagnosticsInput = Parameters<typeof buildOsintDiagnostics>[0];

function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    status: "partial",
    step: "partial",
    progress: {},
    createdAt,
    finishedAt,
    sources: [],
    ...overrides,
  };
}

const API_KEY = "AIzaSyD-FAKE_API_KEY_0123456789abcdefghijk";
const BEARER = "Bearer sk-live-0123456789abcdef";
const SECRET_QUERY = "gizli sorgu Qarabag general Hesenov";
const SECRET_PROMPT = "SYSTEM PROMPT: ignore previous instructions";
const SECRET_MODEL_RESPONSE = "MODEL RESPONSE: the answer is 42";
const SECRET_URL = "https://internal.example.org/path?token=abc123";
const INTERNAL_ID = "9f1c2d3e-aaaa-bbbb-cccc-123456789abc";
const SESSION_TOKEN = "session-token-DEADBEEF";

const WHITELISTED_KEYS = [
  "durationMs",
  "errorClasses",
  "expansionFallbackLanguages",
  "fetchStatus",
  "llmAttempts",
  "providers",
  "searchQueries",
  "sourcesFound",
  "sourcesSelected",
  "stageMs",
  "status",
  "step",
  "summaries",
];

function hostileProgress(): Record<string, unknown> {
  return {
    percent: 77,
    query: SECRET_QUERY,
    prompt: SECRET_PROMPT,
    modelResponse: SECRET_MODEL_RESPONSE,
    apiKey: API_KEY,
    authorization: BEARER,
    runId: INTERNAL_ID,
    userId: INTERNAL_ID,
    token: SESSION_TOKEN,
    urls: [SECRET_URL, "https://another.example.org/a"],
    queries: [SECRET_QUERY],
    notice: "Notice with " + SECRET_QUERY,
    reportNotes: ["bluf_fallback"],
    nested: { deep: { secret: API_KEY, urls: [SECRET_URL] } },
    sourcesFound: 12,
    failedSteps: ["expansion:timeout"],
    expansionFallbackLanguages: [
      "fa",
      "hy",
      "FA",
      "farsi",
      "f",
      SECRET_URL,
      API_KEY,
      "ru ",
      " ru",
      42,
      null,
      { language: "de" },
    ],
    diagnostics: {
      searchQueries: 6,
      sourcesSelected: 9,
      cacheErrors: 0,
      llmAttempts: { summary: 4, report: 2, prompt: SECRET_PROMPT, model: API_KEY },
      providers: [
        "exa",
        "tavily",
        "Exa",
        "My Provider With Spaces",
        "UPPERCASE_PROVIDER",
        "provider-with-dash",
        "p",
        "a".repeat(31),
        SECRET_URL,
        API_KEY,
        BEARER,
        INTERNAL_ID,
        42,
        null,
        { name: "exa", key: API_KEY },
      ],
      stageMs: {
        translating: 120,
        searching: 900,
        "Bad Key With Spaces": 5,
        UPPER: 4,
        [API_KEY]: 7,
        [SECRET_URL]: 9,
        [`${"k".repeat(41)}`]: 3,
        "with-dash": 2,
        with1digit: 8,
        "": 1,
        summarizing: "oops" as unknown as number,
        synthesizing: { prompt: SECRET_PROMPT } as unknown as number,
      },
      prompt: SECRET_PROMPT,
      rawResponse: SECRET_MODEL_RESPONSE,
      apiKey: API_KEY,
      internalId: INTERNAL_ID,
      nested: { deeper: [API_KEY] },
    },
    summaryFailureReasons: { language: 1, prompt: 99, [API_KEY]: 5 },
    summaryStatusCounts: { generation_failed: 1 },
  };
}

function hostileSources(): DiagnosticsInput["sources"] {
  return [
    { hasSummary: true, fetchStatus: "fetched_full", summaryStatus: null },
    { hasSummary: true, fetchStatus: "provider_text", summaryStatus: null },
    { hasSummary: false, fetchStatus: "snippet_fallback", summaryStatus: "generation_failed" },
    { hasSummary: false, fetchStatus: "Has Space", summaryStatus: "insufficient_text" },
    { hasSummary: false, fetchStatus: "UPPERCASE", summaryStatus: "unavailable" },
    { hasSummary: false, fetchStatus: SECRET_URL, summaryStatus: "invalid_output" },
    { hasSummary: false, fetchStatus: API_KEY, summaryStatus: null },
    { hasSummary: false, fetchStatus: "x".repeat(41), summaryStatus: null },
    { hasSummary: false, fetchStatus: "", summaryStatus: null },
  ];
}

describe("buildOsintDiagnostics whitelist", () => {
  it("emits only whitelisted keys and none of the hostile values", () => {
    const result = buildOsintDiagnostics(
      input({ progress: hostileProgress(), sources: hostileSources() }),
    );
    const serialized = JSON.stringify(result);

    for (const forbidden of [
      API_KEY,
      BEARER,
      SECRET_QUERY,
      SECRET_PROMPT,
      SECRET_MODEL_RESPONSE,
      SECRET_URL,
      INTERNAL_ID,
      SESSION_TOKEN,
      "https",
      "internal.example",
      "Qarabag",
      "prompt",
      "apiKey",
      "token",
      "nested",
      "deep",
      "runId",
      "userId",
      "authorization",
      "modelResponse",
      "rawResponse",
      "My Provider",
      "UPPER",
      "Bad Key",
      "with-dash",
      "with1digit",
      "oops",
      "Has Space",
    ]) {
      expect(serialized, `output leaked ${forbidden}`).not.toContain(forbidden);
    }

    expect(Object.keys(result).sort()).toEqual(WHITELISTED_KEYS);
    expect(Object.keys(result.llmAttempts).sort()).toEqual(["report", "summary"]);
    expect(Object.keys(result.summaries).sort()).toEqual(["missing", "present"]);
  });

  it("keeps only lowercase snake_case providers, stage keys and fetch statuses", () => {
    const result = buildOsintDiagnostics(
      input({ progress: hostileProgress(), sources: hostileSources() }),
    );
    expect(result.providers).toEqual(["exa", "tavily"]);
    expect(Object.keys(result.stageMs).sort()).toEqual(["searching", "summarizing", "synthesizing", "translating"]);
    // Hostile stage values collapse to numbers; they never carry through as strings or objects.
    expect(result.stageMs).toEqual({
      translating: 120,
      searching: 900,
      summarizing: 0,
      synthesizing: 0,
    });
    for (const value of Object.values(result.stageMs)) expect(typeof value).toBe("number");
    expect(result.fetchStatus).toEqual({
      fetched_full: 1,
      provider_text: 1,
      snippet_fallback: 1,
    });
    for (const key of Object.keys(result.fetchStatus)) expect(key).toMatch(/^[a-z_]{1,40}$/);
    for (const provider of result.providers) expect(provider).toMatch(/^[a-z_]{2,30}$/);
  });

  it("accepts only two-letter lowercase codes in expansionFallbackLanguages", () => {
    const result = buildOsintDiagnostics(input({ progress: hostileProgress() }));
    expect(result.expansionFallbackLanguages).toEqual(["fa", "hy"]);
  });

  it("reports sanitized counters and survives a non-object progress value", () => {
    const result = buildOsintDiagnostics(
      input({ progress: hostileProgress(), sources: hostileSources() }),
    );
    expect(result.llmAttempts).toEqual({ summary: 4, report: 2 });
    expect(result.searchQueries).toBe(6);
    expect(result.sourcesFound).toBe(12);
    expect(result.sourcesSelected).toBe(9);

    for (const progress of [null, undefined, "string", 42, [], [1, 2], true]) {
      const empty = buildOsintDiagnostics(input({ progress }));
      expect(empty).toEqual({
        status: "partial",
        step: "partial",
        durationMs: 90_500,
        stageMs: {},
        llmAttempts: { summary: 0, report: 0 },
        errorClasses: {},
        providers: [],
        searchQueries: 0,
        sourcesFound: 0,
        sourcesSelected: 0,
        summaries: { present: 0, missing: {} },
        fetchStatus: {},
        expansionFallbackLanguages: [],
      });
    }
  });

  it("clamps negative, fractional, non-finite and non-numeric counters", () => {
    const result = buildOsintDiagnostics(
      input({
        progress: {
          sourcesFound: -4,
          diagnostics: {
            searchQueries: 2.6,
            sourcesSelected: Number.POSITIVE_INFINITY,
            llmAttempts: { summary: "3", report: Number.NaN },
          },
        },
        sources: [{ hasSummary: true, fetchStatus: "fetched_full", summaryStatus: null }],
      }),
    );
    expect(result.sourcesFound).toBe(0);
    expect(result.searchQueries).toBe(3);
    // Non-finite sourcesSelected falls back to the number of stored sources.
    expect(result.sourcesSelected).toBe(1);
    expect(result.llmAttempts).toEqual({ summary: 0, report: 0 });
  });

  it("does not turn prototype-named labels or statuses into non-string output", () => {
    const result = buildOsintDiagnostics(
      input({
        progress: {
          failedSteps: ["constructor", "x:constructor", "x:__proto__", "x:toString", "__proto__"],
        },
        sources: [
          { hasSummary: false, fetchStatus: "constructor", summaryStatus: null },
          { hasSummary: false, fetchStatus: "constructor", summaryStatus: null },
          { hasSummary: false, fetchStatus: "__proto__", summaryStatus: null },
        ],
      }),
    );
    expect(result.errorClasses).toEqual({ other: 5 });
    expect(JSON.stringify(result)).not.toContain("native code");
    expect(JSON.stringify(result)).not.toContain("[object");
    expect(Object.values(result.fetchStatus).every((value) => typeof value === "number")).toBe(
      true,
    );
    expect(result.fetchStatus["constructor"]).toBe(2);
  });
});

describe("errorClassForFailure", () => {
  it.each([
    ["expansion:timeout", "timeout"],
    ["expansion:rate_limit", "rate_limit"],
    ["searching:fa:rate_limit", "rate_limit"],
    ["searching:ru:search_budget", "rate_limit"],
    ["searching:en:timeout", "timeout"],
    ["synthesizing:invalid_json", "invalid_json"],
    ["synthesizing:language", "language"],
    ["synthesizing:schema", "schema"],
    ["summarizing:cache_unavailable", "cache_unavailable"],
    ["report:invalid_source_numbers", "schema"],
    ["report:no_validated_findings", "schema"],
    ["expansion_fallback:timeout", "timeout"],
    ["synthesizing:no_relevant_sources", "other"],
    ["synthesizing:other", "other"],
    ["something_unknown", "other"],
    ["unknown:category", "other"],
    ["", "other"],
  ] as const)("maps %s to %s", (label, expected) => {
    expect(errorClassForFailure(label)).toBe(expected);
  });

  it("does not count incomplete sources as an error class", () => {
    expect(errorClassForFailure("summarizing:incomplete_sources")).toBeNull();
  });

  it("never returns an inherited object property for odd labels", () => {
    for (const label of ["constructor", "x:constructor", "x:__proto__", "__proto__"]) {
      expect(errorClassForFailure(label)).toBe("other");
    }
  });
});

describe("error classes in diagnostics", () => {
  it("derives classes from failedSteps and ignores incomplete_sources", () => {
    const result = buildOsintDiagnostics(
      input({
        progress: {
          failedSteps: [
            "expansion:timeout",
            "searching:fa:rate_limit",
            "searching:ru:rate_limit",
            "summarizing:incomplete_sources",
            "report:invalid_source_numbers",
            "synthesizing:invalid_json",
            "mystery",
            42,
            null,
          ],
        },
      }),
    );
    expect(result.errorClasses).toEqual({
      timeout: 1,
      rate_limit: 2,
      schema: 1,
      invalid_json: 1,
      other: 1,
    });
  });

  it("maps summary failure reasons to classes and adds their counts", () => {
    const result = buildOsintDiagnostics(
      input({
        progress: {
          failedSteps: ["synthesizing:invalid_json"],
          summaryFailureReasons: {
            generation_failed: 2,
            invalid_json: 3,
            schema: 1,
            language: 4,
            source_number: 2,
            missing: 1,
            unknown_reason: 50,
          },
        },
      }),
    );
    expect(result.errorClasses).toEqual({
      other: 2,
      invalid_json: 4,
      schema: 4,
      language: 4,
    });
  });

  it("ignores zero or invalid summary failure counts", () => {
    const result = buildOsintDiagnostics(
      input({
        progress: { summaryFailureReasons: { language: 0, schema: -3, missing: "5", invalid_json: null } },
      }),
    );
    expect(result.errorClasses).toEqual({});
  });

  it("reports cache errors as cache_unavailable", () => {
    const result = buildOsintDiagnostics(
      input({
        progress: {
          failedSteps: ["searching:fa:cache_unavailable"],
          diagnostics: { cacheErrors: 2 },
        },
      }),
    );
    expect(result.errorClasses).toEqual({ cache_unavailable: 3 });

    const none = buildOsintDiagnostics(input({ progress: { diagnostics: { cacheErrors: 0 } } }));
    expect(none.errorClasses).toEqual({});
  });
});

describe("summaries, fetch status and duration", () => {
  it("counts present summaries and missing ones by status", () => {
    const sources: DiagnosticsInput["sources"] = [
      { hasSummary: true, fetchStatus: "fetched_full", summaryStatus: null },
      { hasSummary: true, fetchStatus: "fetched_full", summaryStatus: null },
      // A present summary never counts as missing, even with a stale status.
      { hasSummary: true, fetchStatus: "provider_text", summaryStatus: "generation_failed" },
      { hasSummary: false, fetchStatus: "snippet_fallback", summaryStatus: "generation_failed" },
      { hasSummary: false, fetchStatus: "snippet_fallback", summaryStatus: "generation_failed" },
      { hasSummary: false, fetchStatus: "snippet_fallback", summaryStatus: "insufficient_text" },
      { hasSummary: false, fetchStatus: "failed", summaryStatus: "unavailable" },
      { hasSummary: false, fetchStatus: "failed", summaryStatus: "invalid_output" },
      // Neither present nor missing-with-status: not counted in `summaries`.
      { hasSummary: false, fetchStatus: "failed", summaryStatus: null },
    ];
    const result = buildOsintDiagnostics(input({ sources }));
    expect(result.summaries).toEqual({
      present: 3,
      missing: {
        generation_failed: 2,
        insufficient_text: 1,
        unavailable: 1,
        invalid_output: 1,
      },
    });
    expect(result.fetchStatus).toEqual({
      fetched_full: 2,
      provider_text: 1,
      snippet_fallback: 3,
      failed: 3,
    });
    const statuses: SummaryStatus[] = [
      "unavailable",
      "insufficient_text",
      "generation_failed",
      "invalid_output",
    ];
    for (const key of Object.keys(result.summaries.missing)) {
      expect(statuses).toContain(key);
    }
  });

  it("falls back to stored source count when diagnostics has no sourcesSelected", () => {
    const sources: DiagnosticsInput["sources"] = [
      { hasSummary: true, fetchStatus: "fetched_full", summaryStatus: null },
      { hasSummary: true, fetchStatus: "fetched_full", summaryStatus: null },
    ];
    expect(buildOsintDiagnostics(input({ sources })).sourcesSelected).toBe(2);
    expect(
      buildOsintDiagnostics(input({ sources, progress: { diagnostics: { sourcesSelected: 7 } } }))
        .sourcesSelected,
    ).toBe(7);
  });

  it("computes durationMs from timestamps and returns null while unfinished", () => {
    expect(buildOsintDiagnostics(input()).durationMs).toBe(90_500);
    expect(buildOsintDiagnostics(input({ finishedAt: null, status: "running" })).durationMs).toBe(
      null,
    );
  });

  it("passes status and step through unchanged", () => {
    const result = buildOsintDiagnostics(input({ status: "running", step: "summarizing" }));
    expect(result.status).toBe("running");
    expect(result.step).toBe("summarizing");
  });
});

describe("osintDiagnosticsFor access control", () => {
  it("returns null for non-admin roles and a whitelisted object for admins", () => {
    const base = input({ progress: hostileProgress(), sources: hostileSources() });
    expect(osintDiagnosticsFor({ role: "user" }, base)).toBeNull();
    const admin = osintDiagnosticsFor({ role: "admin" }, base) as OsintDiagnostics | null;
    expect(admin).not.toBeNull();
    expect(Object.keys(admin ?? {}).sort()).toEqual(WHITELISTED_KEYS);
    expect(JSON.stringify(admin)).not.toContain(API_KEY);
  });

  it("does not return diagnostics for unknown or missing roles", () => {
    const base = input();
    expect(osintDiagnosticsFor({ role: "ADMIN" } as unknown as { role: "admin" }, base)).toBeNull();
    expect(osintDiagnosticsFor({ role: "" } as unknown as { role: "admin" }, base)).toBeNull();
    expect(osintDiagnosticsFor({} as unknown as { role: "admin" }, base)).toBeNull();
  });
});

describe("mergeRetryDiagnostics", () => {
  const added = { elapsedMs: 2_500, summaryCalls: 2, reportAttempts: 1 };

  it("accumulates stage time and attempts on top of previous diagnostics", () => {
    const merged = mergeRetryDiagnostics(
      {
        diagnostics: {
          stageMs: { searching: 900, summary_retrying: 1_000 },
          searchQueries: 6,
          providers: ["exa", "tavily"],
          sourcesSelected: 9,
          llmAttempts: { summary: 4, report: 2 },
          cacheErrors: 1,
        },
      },
      added,
    );
    expect(merged).toEqual({
      stageMs: { searching: 900, summary_retrying: 3_500 },
      searchQueries: 6,
      providers: ["exa", "tavily"],
      sourcesSelected: 9,
      llmAttempts: { summary: 6, report: 3 },
      cacheErrors: 1,
    });
  });

  it("accumulates over repeated retries", () => {
    const first = mergeRetryDiagnostics({}, added);
    const second = mergeRetryDiagnostics({ diagnostics: first }, added);
    expect(second.stageMs["summary_retrying"]).toBe(5_000);
    expect(second.llmAttempts).toEqual({ summary: 4, report: 2 });
  });

  it("starts from zero when there is no usable previous progress", () => {
    for (const previous of [null, undefined, "x", 5, [], { diagnostics: "nope" }]) {
      expect(mergeRetryDiagnostics(previous, added)).toEqual({
        stageMs: { summary_retrying: 2_500 },
        searchQueries: 0,
        providers: [],
        sourcesSelected: 0,
        llmAttempts: { summary: 2, report: 1 },
        cacheErrors: 0,
      });
    }
  });

  it("sanitizes old values and never carries hostile data forward", () => {
    const merged = mergeRetryDiagnostics(
      {
        query: SECRET_QUERY,
        diagnostics: {
          stageMs: { "Bad Key": 5, searching: -10, translating: "x", [API_KEY]: 1, summarizing: 3.4 },
          searchQueries: "many",
          providers: ["exa", "Not Allowed", SECRET_URL, API_KEY, 7],
          sourcesSelected: -2,
          llmAttempts: { summary: "3", report: 1.4, prompt: SECRET_PROMPT },
          cacheErrors: Number.NaN,
          prompt: SECRET_PROMPT,
          apiKey: API_KEY,
        },
      },
      { elapsedMs: -50, summaryCalls: 0, reportAttempts: 0 },
    );
    expect(merged).toEqual({
      // Negative elapsed time never reduces the accumulated total.
      stageMs: { searching: 0, translating: 0, summarizing: 3, summary_retrying: 0 },
      searchQueries: 0,
      providers: ["exa"],
      sourcesSelected: 0,
      llmAttempts: { summary: 0, report: 1 },
      cacheErrors: 0,
    });
    const serialized = JSON.stringify(merged);
    for (const forbidden of [SECRET_QUERY, SECRET_PROMPT, API_KEY, SECRET_URL, "Bad Key", "Not Allowed"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rounds elapsed time to whole milliseconds", () => {
    expect(mergeRetryDiagnostics({}, { ...added, elapsedMs: 1_234.6 }).stageMs).toEqual({
      summary_retrying: 1_235,
    });
  });
});
