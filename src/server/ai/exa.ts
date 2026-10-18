import type { RequestCallBudget, SearchInput, SearchProvider, SearchSource } from "./types";
import { requireServerEnv } from "../env";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 5_000;

type ExaResult = {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  text?: unknown;
  highlights?: unknown;
};

export class ExaRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly retryAfter?: string,
  ) {
    super("Exa search request failed with HTTP " + statusCode + ".");
    this.name = "ExaRequestError";
  }
}

export class SearchRequestBudgetExceededError extends Error {
  constructor() {
    super("Search request budget exhausted.");
    this.name = "SearchRequestBudgetExceededError";
  }
}

export function parseExaSearchResponse(value: unknown): SearchSource[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Exa response.");
  }
  const results = (value as Record<string, unknown>)["results"];
  if (!Array.isArray(results)) throw new Error("Invalid Exa response.");
  return results.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as ExaResult;
    if (typeof row.url !== "string" || !row.url.trim()) return [];
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : row.url;
    const highlights = Array.isArray(row.highlights)
      ? row.highlights.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [];
    return [
      {
        url: row.url.trim(),
        title,
        ...(typeof row.publishedDate === "string" ? { publishedDate: row.publishedDate } : {}),
        ...(typeof row.text === "string" && row.text.trim() ? { text: row.text.trim() } : {}),
        ...(highlights.length ? { highlights } : {}),
        index: index + 1,
      },
    ];
  });
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function signalFor(input: SearchInput): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? 15_000);
  return input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
}

export class ExaProvider implements SearchProvider {
  readonly provider = "exa" as const;
  readonly model = "exa-search-auto";
  readonly usageStats = { apiCalls: 0, inputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly apiKey = requireServerEnv("EXA_API_KEY"),
    private readonly request: typeof fetch = fetch,
  ) {}

  async search(input: SearchInput): Promise<SearchSource[]> {
    const body: Record<string, unknown> = {
      query: input.query,
      type: "auto",
      numResults: Math.min(5, Math.max(1, input.limit)),
      contents: { text: { maxCharacters: 12_000 } },
    };
    if (input.startPublishedDate) body["startPublishedDate"] = input.startPublishedDate;
    if (input.endPublishedDate) body["endPublishedDate"] = input.endPublishedDate;
    if (input.userLocation) body["userLocation"] = input.userLocation;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      input.requestBudget?.reserve();
      this.usageStats.apiCalls += 1;
      const response = await this.request(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: signalFor(input),
      });
      if (response.ok) {
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new Error("Invalid Exa response.");
        }
        return parseExaSearchResponse(data);
      }
      const waitMs =
        response.status === 429 ? retryAfterMs(response.headers.get("retry-after")) : undefined;
      if (
        response.status !== 429 ||
        attempt + 1 >= MAX_RETRIES ||
        (waitMs ?? 0) > MAX_RETRY_WAIT_MS
      ) {
        throw new ExaRequestError(
          response.status,
          response.headers.get("retry-after") ?? undefined,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(500 * (attempt + 1), waitMs ?? 0)),
      );
    }
    return [];
  }
}

export class SearchRequestBudget implements RequestCallBudget {
  calls = 0;

  constructor(readonly maxCalls: number) {}

  reserve(): void {
    if (this.calls >= this.maxCalls) throw new SearchRequestBudgetExceededError();
    this.calls += 1;
  }
}
