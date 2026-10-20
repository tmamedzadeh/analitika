import { createHash } from "node:crypto";

import type { OsintLanguage, OsintPeriod } from "@/lib/osint";

const trackingParameters = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

export function normalizeOsintQuery(query: string): string {
  return query.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function createOsintSearchCacheKey(input: {
  provider: string;
  language: string;
  query: string;
  period: OsintPeriod;
  includeDomains?: string[];
}): string {
  const value = JSON.stringify({
    provider: input.provider,
    language: input.language.toLowerCase(),
    query: normalizeOsintQuery(input.query),
    period: input.period,
    includeDomains: [...new Set(input.includeDomains ?? [])]
      .map((domain) => domain.toLowerCase())
      .sort(),
  });
  return createHash("sha256").update(value).digest("hex");
}

export function createOsintCacheKey(
  query: string,
  languages: OsintLanguage[],
  period: OsintPeriod,
  providerIdentity = "gemini",
): string {
  const value = JSON.stringify({
    pipelineVersion: 4,
    query: normalizeOsintQuery(query),
    languages: [...new Set(languages)].sort(),
    period,
    providerIdentity,
  });
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeOsintUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.port) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function similarOsintTitle(first: string, second: string): boolean {
  const left = new Set(
    normalizeOsintTitle(first)
      .split(" ")
      .filter((word) => word.length > 2),
  );
  const right = new Set(
    normalizeOsintTitle(second)
      .split(" ")
      .filter((word) => word.length > 2),
  );
  if (left.size === 0 || right.size === 0) return false;
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.min(left.size, right.size) >= 0.8;
}

export function normalizeOsintTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isWithinOsintPeriod(
  date: Date | null,
  period: OsintPeriod,
  now = new Date(),
): boolean {
  if (period === "all") return true;
  if (!date || !Number.isFinite(date.getTime())) return false;
  const duration = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[period] * 60 * 60 * 1000;
  return date.getTime() >= now.getTime() - duration && date.getTime() <= now.getTime();
}

const osintScripts: Partial<Record<OsintLanguage, RegExp>> = {
  fa: /\p{Script=Arabic}/u,
  hy: /\p{Script=Armenian}/u,
  ru: /\p{Script=Cyrillic}/u,
  zh: /\p{Script=Han}/u,
  ka: /\p{Script=Georgian}/u,
};

/** Rejects search results whose text is clearly written in a different script. */
export function matchesOsintLanguageScript(text: string, language: OsintLanguage): boolean {
  const expectedScript = osintScripts[language];
  if (!expectedScript) return true;

  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return false;
  const matchingLetters = letters.filter((letter) => expectedScript.test(letter)).length;
  return matchingLetters >= 12 && matchingLetters / letters.length >= 0.2;
}

export function getPeriodStart(period: OsintPeriod, now = new Date()): string | undefined {
  if (period === "all") return undefined;
  const hours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[period];
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}
