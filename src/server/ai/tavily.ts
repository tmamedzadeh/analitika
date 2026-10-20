import type {
  RequestCallBudget,
  SearchInput,
  SearchProvider,
  SearchProviderCapabilities,
  SearchSource,
} from "./types";
import { requireServerEnv } from "../env";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export const tavilyCapabilities: SearchProviderCapabilities = {
  hasText: false,
  supportsDomains: true,
  supportsCountry: true,
  supportsLanguage: true,
  supportsDateRange: true,
};

export class TavilyRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly retryAfter?: string,
  ) {
    super(`Tavily search request failed with HTTP ${statusCode}.`);
    this.name = "TavilyRequestError";
  }
}

type TavilyResult = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  published_date?: unknown;
};

function toDay(value: string): string {
  return value.slice(0, 10);
}

function normalizeResults(value: unknown): SearchSource[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Tavily response.");
  }
  const results = (value as Record<string, unknown>)["results"];
  if (!Array.isArray(results)) throw new Error("Invalid Tavily response.");
  return results.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as TavilyResult;
    if (typeof row.url !== "string" || !row.url.trim()) return [];
    const snippet = typeof row.content === "string" ? row.content.trim() : "";
    return [
      {
        url: row.url.trim(),
        title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : row.url,
        ...(typeof row.published_date === "string"
          ? { publishedDate: row.published_date, publishedAt: row.published_date }
          : {}),
        ...(snippet ? { highlights: [snippet] } : {}),
        ...(snippet ? { snippet } : {}),
        index: index + 1,
        providerRank: index + 1,
        provider: "tavily",
        providers: ["tavily"],
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
  const timeout = AbortSignal.timeout(input.timeoutMs ?? 15_000);
  return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
}

const countryNames: Record<string, string> = {
  AM: "armenia",
  CN: "china",
  FR: "france",
  GE: "georgia",
  IR: "iran",
  RU: "russia",
  US: "united states",
  AZ: "azerbaijan",
};

export class TavilyProvider implements SearchProvider {
  readonly provider = "tavily" as const;
  readonly capabilities = tavilyCapabilities;
  readonly usageStats = { apiCalls: 0, credits: 0 };

  constructor(
    private readonly apiKey = requireServerEnv("TAVILY_API_KEY"),
    private readonly request: typeof fetch = fetch,
  ) {}

  async search(input: SearchInput): Promise<SearchSource[]> {
    const body: Record<string, unknown> = {
      query: input.query,
      search_depth: "basic",
      topic: "general",
      max_results: Math.min(10, Math.max(1, input.numResults ?? input.limit ?? 5)),
      include_answer: false,
      include_raw_content: false,
      include_published_date: true,
      include_usage: true,
      filter_by_published_date: false,
    };
    if (input.language) body["language"] = input.language.toLowerCase();
    if (input.country ?? input.userLocation) {
      const country = input.country ?? input.userLocation!;
      body["country"] = countryNames[country.toUpperCase()] ?? country.toLowerCase();
    }
    if (input.startPublishedDate) body["start_date"] = toDay(input.startPublishedDate);
    if (input.endPublishedDate) body["end_date"] = toDay(input.endPublishedDate);
    if (input.includeDomains?.length) body["include_domains"] = input.includeDomains;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      input.requestBudget?.reserve();
      this.usageStats.apiCalls += 1;
      const response = await this.request(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: signalFor(input),
      });
      if (response.ok) {
        const data: unknown = await response.json();
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const usage = (data as Record<string, unknown>)["usage"];
          if (usage && typeof usage === "object") {
            const credits = (usage as Record<string, unknown>)["credits"];
            if (typeof credits === "number") this.usageStats.credits += credits;
          }
        }
        return normalizeResults(data);
      }
      const waitMs =
        response.status === 429 ? retryAfterMs(response.headers.get("retry-after")) : undefined;
      if (response.status !== 429 || attempt === 1 || (waitMs ?? 0) > 5_000) {
        throw new TavilyRequestError(
          response.status,
          response.headers.get("retry-after") ?? undefined,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(500, waitMs ?? 0)));
    }
    return [];
  }
}

export function isRequestCallBudget(value: unknown): value is RequestCallBudget {
  return Boolean(value && typeof value === "object" && "reserve" in value);
}
