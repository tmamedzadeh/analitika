import type { OsintLanguage } from "@/lib/osint";
import type { SearchProviderId } from "../ai/types";

export type RegistrySourceType =
  | "state_media"
  | "independent_media"
  | "public_broadcaster"
  | "international_media"
  | "official"
  | "think_tank"
  | "agency"
  | "domestic_media"
  | "academic";

export type RegistrySource = {
  domain: string;
  language: OsintLanguage;
  type: RegistrySourceType;
  affiliation: string;
};

/** Descriptive source metadata only; this registry does not score reliability. */
export const SOURCE_REGISTRY: readonly RegistrySource[] = [
  {
    domain: "irna.ir",
    language: "fa",
    type: "state_media",
    affiliation: "state-owned news agency",
  },
  {
    domain: "tasnimnews.com",
    language: "fa",
    type: "domestic_media",
    affiliation: "state-aligned",
  },
  {
    domain: "mehrnews.com",
    language: "fa",
    type: "domestic_media",
    affiliation: "state-affiliated",
  },
  {
    domain: "bbc.com",
    language: "fa",
    type: "international_media",
    affiliation: "public broadcaster",
  },
  {
    domain: "armenpress.am",
    language: "hy",
    type: "agency",
    affiliation: "state-owned news agency",
  },
  {
    domain: "1lurer.am",
    language: "hy",
    type: "public_broadcaster",
    affiliation: "public broadcaster",
  },
  {
    domain: "civilnet.am",
    language: "hy",
    type: "independent_media",
    affiliation: "independent nonprofit media",
  },
  {
    domain: "azatutyun.am",
    language: "hy",
    type: "international_media",
    affiliation: "international public broadcaster",
  },
  {
    domain: "tass.ru",
    language: "ru",
    type: "state_media",
    affiliation: "state-owned news agency",
  },
  { domain: "ria.ru", language: "ru", type: "state_media", affiliation: "state-owned media" },
  {
    domain: "meduza.io",
    language: "ru",
    type: "independent_media",
    affiliation: "independent media",
  },
  { domain: "interfax.ru", language: "ru", type: "agency", affiliation: "commercial news agency" },
  {
    domain: "xinhuanet.com",
    language: "zh",
    type: "state_media",
    affiliation: "state news agency",
  },
  { domain: "people.cn", language: "zh", type: "state_media", affiliation: "state-owned media" },
  { domain: "thepaper.cn", language: "zh", type: "domestic_media", affiliation: "domestic media" },
  {
    domain: "rfa.org",
    language: "zh",
    type: "international_media",
    affiliation: "international broadcaster",
  },
  {
    domain: "reuters.com",
    language: "en",
    type: "agency",
    affiliation: "international news agency",
  },
  {
    domain: "apnews.com",
    language: "en",
    type: "agency",
    affiliation: "international news agency",
  },
  {
    domain: "bbc.com",
    language: "en",
    type: "public_broadcaster",
    affiliation: "public broadcaster",
  },
  {
    domain: "aljazeera.com",
    language: "en",
    type: "international_media",
    affiliation: "international broadcaster",
  },
  {
    domain: "csis.org",
    language: "en",
    type: "think_tank",
    affiliation: "independent policy research organization",
  },
  {
    domain: "rusi.org",
    language: "en",
    type: "think_tank",
    affiliation: "defence and security research institute",
  },
  {
    domain: "iiss.org",
    language: "en",
    type: "think_tank",
    affiliation: "international affairs research institute",
  },
  {
    domain: "inss.org.il",
    language: "en",
    type: "think_tank",
    affiliation: "national security research institute",
  },
  {
    domain: "missilethreat.csis.org",
    language: "en",
    type: "think_tank",
    affiliation: "CSIS missile analysis project",
  },
  { domain: "1news.az", language: "en", type: "domestic_media", affiliation: "not assessed" },
  {
    domain: "axios.com",
    language: "en",
    type: "international_media",
    affiliation: "US news publisher",
  },
  { domain: "apa.az", language: "en", type: "agency", affiliation: "news agency" },
  { domain: "apa.az", language: "az", type: "agency", affiliation: "Azerbaijani news agency" },
  { domain: "report.az", language: "az", type: "domestic_media", affiliation: "Azerbaijani media" },
  { domain: "trend.az", language: "az", type: "agency", affiliation: "news agency" },
  { domain: "azertag.az", language: "az", type: "agency", affiliation: "state news agency" },
  { domain: "1news.az", language: "az", type: "domestic_media", affiliation: "Azerbaijani media" },
  {
    domain: "musavat.com",
    language: "az",
    type: "domestic_media",
    affiliation: "Azerbaijani media",
  },
  { domain: "turan.az", language: "az", type: "agency", affiliation: "independent news agency" },
  { domain: "azadliq.org", language: "az", type: "international_media", affiliation: "RFE/RL" },
  {
    domain: "meydan.tv",
    language: "az",
    type: "independent_media",
    affiliation: "independent media",
  },
  {
    domain: "president.az",
    language: "az",
    type: "official",
    affiliation: "President of Azerbaijan",
  },
  {
    domain: "mfa.gov.az",
    language: "az",
    type: "official",
    affiliation: "Ministry of Foreign Affairs",
  },
  { domain: "mod.gov.az", language: "az", type: "official", affiliation: "Ministry of Defense" },
  { domain: "aircenter.az", language: "az", type: "think_tank", affiliation: "research center" },
  {
    domain: "meta-defense.fr",
    language: "en",
    type: "independent_media",
    affiliation: "not assessed",
  },
  {
    domain: "themoscowtimes.com",
    language: "en",
    type: "independent_media",
    affiliation: "independent news publication",
  },
  {
    domain: "france24.com",
    language: "fr",
    type: "international_media",
    affiliation: "international public broadcaster",
  },
  {
    domain: "rfi.fr",
    language: "fr",
    type: "public_broadcaster",
    affiliation: "public broadcaster",
  },
  { domain: "lemonde.fr", language: "fr", type: "independent_media", affiliation: "private media" },
  { domain: "afp.com", language: "fr", type: "agency", affiliation: "international news agency" },
  {
    domain: "1tv.ge",
    language: "ka",
    type: "public_broadcaster",
    affiliation: "public broadcaster",
  },
  {
    domain: "civil.ge",
    language: "ka",
    type: "independent_media",
    affiliation: "independent media",
  },
  {
    domain: "netgazeti.ge",
    language: "ka",
    type: "independent_media",
    affiliation: "independent media",
  },
  {
    domain: "interpressnews.ge",
    language: "ka",
    type: "agency",
    affiliation: "commercial news agency",
  },
  { domain: "agenda.ge", language: "ka", type: "official", affiliation: "government news service" },
  // Reachability checked with the same probe as scripts/verify-osint-registry.ts. Ownership and
  // editorial orientation were not verified, so these carry a neutral descriptive affiliation.
  { domain: "unikal.az", language: "az", type: "domestic_media", affiliation: "domestic news outlet" },
  {
    domain: "yenisabah.az",
    language: "az",
    type: "domestic_media",
    affiliation: "domestic news outlet",
  },
  { domain: "konkret.az", language: "az", type: "domestic_media", affiliation: "domestic news outlet" },
  { domain: "ordu.az", language: "az", type: "domestic_media", affiliation: "domestic news outlet" },
  { domain: "ednews.net", language: "az", type: "domestic_media", affiliation: "domestic news outlet" },
  {
    domain: "armenianarchitecture.org",
    language: "hy",
    type: "academic",
    affiliation: "cultural heritage documentation project",
  },
];

export function registryForLanguage(language: OsintLanguage): RegistrySource[] {
  return SOURCE_REGISTRY.filter((source) => source.language === language).map((source) => ({
    ...source,
  }));
}

export function registryDomains(language: OsintLanguage): string[] {
  return registryForLanguage(language).map((source) => source.domain);
}

export function sourceRegistryEntry(
  domain: string,
  language?: OsintLanguage,
): RegistrySource | undefined {
  const hostname = domain.toLowerCase().replace(/^www\./, "");
  return SOURCE_REGISTRY.find(
    (source) =>
      (!language || source.language === language) &&
      (hostname === source.domain || hostname.endsWith(`.${source.domain}`)),
  );
}

export function providerList(providers: readonly string[] | undefined): SearchProviderId[] {
  const supported: SearchProviderId[] = ["exa", "tavily", "hasdata", "gemini_grounding"];
  return [
    ...new Set(
      (providers ?? []).filter((provider): provider is SearchProviderId =>
        supported.includes(provider as SearchProviderId),
      ),
    ),
  ];
}
