import type {
  SearchInput,
  SearchProvider,
  SearchProviderCapabilities,
  SearchSource,
} from "./types";
import { requireServerEnv } from "../env";

const HASDATA_SERP_URL = "https://api.hasdata.com/scrape/google/serp";
const HASDATA_LIGHT_URL = "https://api.hasdata.com/scrape/google-light/serp";

export const hasDataCapabilities: SearchProviderCapabilities = {
  hasText: false,
  supportsDomains: false,
  supportsCountry: true,
  supportsLanguage: true,
  supportsDateRange: false,
};

export class HasDataRequestError extends Error {
  constructor(readonly statusCode: number) {
    super(`HasData search request failed with HTTP ${statusCode}.`);
    this.name = "HasDataRequestError";
  }
}

type HasDataResult = {
  link?: unknown;
  title?: unknown;
  snippet?: unknown;
  date?: unknown;
  position?: unknown;
};

export function parseHasDataResponse(value: unknown): SearchSource[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid HasData response.");
  }
  const results = (value as Record<string, unknown>)["organicResults"];
  if (!Array.isArray(results)) throw new Error("Invalid HasData response.");
  return results.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as HasDataResult;
    if (typeof row.link !== "string" || !row.link.trim()) return [];
    return [
      {
        url: row.link.trim(),
        title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : row.link,
        ...(typeof row.date === "string" ? { publishedDate: row.date, publishedAt: row.date } : {}),
        ...(typeof row.snippet === "string" && row.snippet.trim()
          ? { highlights: [row.snippet.trim()], snippet: row.snippet.trim() }
          : {}),
        index: typeof row.position === "number" ? row.position : index + 1,
        providerRank: typeof row.position === "number" ? row.position : index + 1,
        provider: "hasdata",
        providers: ["hasdata"],
      },
    ];
  });
}

const countryCodes: Record<string, string> = {
  AM: "am",
  CN: "cn",
  FR: "fr",
  GE: "ge",
  IR: "ir",
  RU: "ru",
  US: "us",
};

export class HasDataProvider implements SearchProvider {
  readonly provider = "hasdata" as const;
  readonly capabilities = hasDataCapabilities;
  readonly usageStats = { apiCalls: 0 };

  constructor(
    private readonly apiKey = requireServerEnv("HASDATA_API_KEY"),
    private readonly mode: "light" | "full" = "light",
    private readonly request: typeof fetch = fetch,
  ) {}

  async search(input: SearchInput): Promise<SearchSource[]> {
    const url = new URL(this.mode === "light" ? HASDATA_LIGHT_URL : HASDATA_SERP_URL);
    url.searchParams.set("q", input.query);
    url.searchParams.set(
      "num",
      String(Math.min(10, Math.max(1, input.numResults ?? input.limit ?? 5))),
    );
    if (input.language) url.searchParams.set("hl", input.language.toLowerCase());
    const country = input.country ?? input.userLocation;
    if (country)
      url.searchParams.set("gl", countryCodes[country.toUpperCase()] ?? country.toLowerCase());

    input.requestBudget?.reserve();
    this.usageStats.apiCalls += 1;
    const response = await this.request(url, {
      method: "GET",
      headers: { "x-api-key": this.apiKey, accept: "application/json" },
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 15_000)])
        : AbortSignal.timeout(input.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new HasDataRequestError(response.status);
    return parseHasDataResponse(await response.json());
  }
}
