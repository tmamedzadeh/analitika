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

export function createOsintCacheKey(
  query: string,
  languages: OsintLanguage[],
  period: OsintPeriod,
  providerIdentity = "gemini",
): string {
  const value = JSON.stringify({
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
  const tokenize = (title: string) =>
    new Set(
      title
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 2),
    );
  const left = tokenize(first);
  const right = tokenize(second);
  if (left.size === 0 || right.size === 0) return false;
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.min(left.size, right.size) >= 0.8;
}

export function isWithinOsintPeriod(
  date: Date | null,
  period: OsintPeriod,
  now = new Date(),
): boolean {
  if (!date || period === "all") return true;
  const duration = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[period] * 60 * 60 * 1000;
  return (
    date.getTime() >= now.getTime() - duration &&
    date.getTime() <= now.getTime() + 24 * 60 * 60 * 1000
  );
}

export function getPeriodStart(period: OsintPeriod, now = new Date()): string | undefined {
  if (period === "all") return undefined;
  const hours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[period];
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}
