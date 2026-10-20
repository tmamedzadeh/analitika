import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders, RequestOptions } from "node:http";

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import robotsParser from "robots-parser";

import { resolvePublicHost } from "./ssrf";
import { decodeHtmlBytes } from "./charset";
import { createPinnedLookup } from "./pinned-lookup";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ROBOTS_AGENT = "AnalitikaOSINTBot";
const robotsCache = new Map<
  string,
  { parser: ReturnType<typeof robotsParser>; fetchedAt: number }
>();
const robotsNextRequestAt = new Map<string, number>();

type HttpResult = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  url: URL;
};

export type PublicPage = {
  fetched: boolean;
  text: string;
  fetchStatus:
    | "fetched_full"
    | "snippet_fallback"
    | "robots_denied"
    | "dns_or_network_error"
    | "http_error"
    | "non_html"
    | "timeout"
    | "invalid_url";
  title?: string;
  publishedAt?: Date;
};

async function requestOnce(
  url: URL,
  timeoutMs: number,
  byteLimit: number,
  method: "GET" | "HEAD" = "GET",
): Promise<HttpResult> {
  const deadline = Date.now() + timeoutMs;
  const resolved = await resolvePublicHost(url.hostname, Math.min(timeoutMs, 1200));
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Page request timed out");
  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port || undefined,
    method,
    path: `${url.pathname}${url.search}`,
    headers: {
      "user-agent": `${ROBOTS_AGENT}/1.0 (+public source research)`,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
      "accept-encoding": "identity",
      connection: "close",
    },
    timeout: remaining,
    ...(url.protocol === "https:" ? { servername: url.hostname.replace(/^\[|\]$/g, "") } : {}),
    lookup: createPinnedLookup(resolved.address, resolved.family),
  };
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      requestOptions,
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.resume();
          resolve({ status, headers: response.headers, body: Buffer.alloc(0), url });
          return;
        }

        const length = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(length) && length > byteLimit) {
          response.destroy(new Error("Page exceeds the configured size limit"));
          reject(new Error("Page exceeds the configured size limit"));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (part: Buffer | string) => {
          const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
          bytes += chunk.length;
          if (bytes > byteLimit) {
            response.destroy(new Error("Page exceeds the configured size limit"));
            reject(new Error("Page exceeds the configured size limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({ status, headers: response.headers, body: Buffer.concat(chunks), url });
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(remaining, () => request.destroy(new Error("Page request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function requestWithRedirects(
  initialUrl: string,
  timeoutMs: number,
  byteLimit: number,
  checkRobots: boolean,
): Promise<HttpResult | null> {
  const deadline = Date.now() + timeoutMs;
  let url: URL;
  try {
    url = new URL(initialUrl);
  } catch {
    return null;
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.port) return null;
    if (url.username || url.password) return null;
    if (checkRobots && !(await isAllowedByRobots(url, remaining))) return null;
    const requestTime = deadline - Date.now();
    if (requestTime <= 0) return null;
    let result: HttpResult;
    try {
      result = await requestOnce(url, requestTime, byteLimit);
    } catch {
      return null;
    }
    const location = result.headers.location;
    if (![301, 302, 303, 307, 308].includes(result.status) || !location) return result;
    if (redirects === MAX_REDIRECTS) return null;
    try {
      url = new URL(location, url);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Follows redirects with HEAD requests only (no body is read) and returns the last URL reached.
 * Redirect targets are re-validated against the SSRF guard on every hop; any failure returns the
 * last URL that was successfully reached, never throws.
 */
export async function resolveFinalUrl(initialUrl: string, timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let url: URL;
  try {
    url = new URL(initialUrl);
  } catch {
    return initialUrl;
  }
  let reached = url;
  for (let redirects = 0; redirects < MAX_REDIRECTS; redirects += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (url.protocol !== "http:" && url.protocol !== "https:") break;
    if (url.port || url.username || url.password) break;
    let result: HttpResult;
    try {
      result = await requestOnce(url, remaining, 1024, "HEAD");
    } catch {
      break;
    }
    reached = url;
    const location = result.headers.location;
    if (![301, 302, 303, 307, 308].includes(result.status) || !location) break;
    try {
      url = new URL(location, url);
    } catch {
      break;
    }
  }
  return reached.toString();
}

async function isAllowedByRobots(url: URL, timeoutMs: number): Promise<boolean> {
  const origin = url.origin;
  const cached = robotsCache.get(origin);
  let parser =
    cached?.fetchedAt && Date.now() - cached.fetchedAt < 30 * 60 * 1000 ? cached.parser : undefined;

  if (!parser) {
    const result = await requestWithRedirects(
      new URL("/robots.txt", origin).toString(),
      Math.min(timeoutMs, 2500),
      256 * 1024,
      false,
    );
    if (!result) return false;
    if (result.status === 404 || result.status === 410) {
      parser = robotsParser(new URL("/robots.txt", origin).toString(), "User-agent: *\nAllow: /");
    } else if (result.status >= 200 && result.status < 300) {
      parser = robotsParser(
        new URL("/robots.txt", origin).toString(),
        result.body.toString("utf8"),
      );
    } else {
      return false;
    }
    robotsCache.set(origin, { parser, fetchedAt: Date.now() });
  }
  if (parser.isAllowed(url.toString(), ROBOTS_AGENT) === false) return false;
  const crawlDelay = parser.getCrawlDelay(ROBOTS_AGENT) ?? 0;
  if (crawlDelay > 0) {
    const now = Date.now();
    const scheduledAt = Math.max(now, robotsNextRequestAt.get(origin) ?? now);
    const waitMs = scheduledAt - now;
    if (waitMs >= timeoutMs) return false;
    robotsNextRequestAt.set(origin, scheduledAt + crawlDelay * 1000);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return true;
}

function publicationDate(document: Document): Date | undefined {
  const candidates = [
    document.querySelector('meta[property="article:published_time"]')?.getAttribute("content"),
    document.querySelector('meta[name="date"]')?.getAttribute("content"),
    document.querySelector('meta[name="pubdate"]')?.getAttribute("content"),
    document.querySelector("time[datetime]")?.getAttribute("datetime"),
  ];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? "");
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const dateValue = (entry as Record<string, unknown>)["datePublished"];
        if (typeof dateValue !== "string") continue;
        const date = new Date(dateValue);
        if (Number.isFinite(date.getTime())) return date;
      }
    } catch {
      // Ignore invalid embedded metadata.
    }
  }
  return undefined;
}

export async function fetchPublicPage(url: string, timeoutMs = 8000): Promise<PublicPage> {
  const startedAt = Date.now();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { fetched: false, text: "", fetchStatus: "invalid_url" };
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return { fetched: false, text: "", fetchStatus: "invalid_url" };
  }
  try {
    await resolvePublicHost(parsed.hostname, Math.min(timeoutMs, 1200));
  } catch {
    return { fetched: false, text: "", fetchStatus: "dns_or_network_error" };
  }
  if (!(await isAllowedByRobots(parsed, timeoutMs))) {
    return { fetched: false, text: "", fetchStatus: "robots_denied" };
  }
  const response = await requestWithRedirects(url, timeoutMs, MAX_PAGE_BYTES, false);
  if (!response) {
    return {
      fetched: false,
      text: "",
      fetchStatus: Date.now() - startedAt >= timeoutMs ? "timeout" : "dns_or_network_error",
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return { fetched: false, text: "", fetchStatus: "http_error" };
  }
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    return { fetched: false, text: "", fetchStatus: "non_html" };
  }

  const window = parseHTML(
    decodeHtmlBytes(response.body, String(response.headers["content-type"] ?? "")),
  );
  const document = window.document;
  const publishedAt = publicationDate(document);
  const title =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
    document.title?.trim() ||
    undefined;
  const article = new Readability(document).parse();
  const text = (article?.textContent || document.body?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
  const finalPath = response.url.pathname.toLowerCase();
  const loginOrPaywall =
    /\/(login|log-in|signin|sign-in|subscribe|subscription|paywall)(\/|$)/.test(finalPath) ||
    Boolean(document.querySelector('[id*="paywall" i], [class*="paywall" i]')) ||
    (/subscribe to continue|sign in to continue|log in to read|subscription required/i.test(
      document.body?.textContent ?? "",
    ) &&
      text.length < 3000);
  if (loginOrPaywall) return { fetched: false, text: "", fetchStatus: "snippet_fallback" };
  const articleTitle = article?.title || title;
  return {
    fetched: text.length > 0,
    text,
    fetchStatus: text.length > 0 ? "fetched_full" : "snippet_fallback",
    ...(articleTitle ? { title: articleTitle } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
