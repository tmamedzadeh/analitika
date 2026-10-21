/** Public GET probes only. Never syncs functions, sends events, logs in, or deploys. */
import { writeFile } from "node:fs/promises";
import "../src/server/env";

const configured = process.env["APP_URL"] ?? process.env["VERCEL_PROJECT_PRODUCTION_URL"];
const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : configured
    ? [configured.startsWith("http") ? configured : `https://${configured}`]
    : ["https://analitika-one.vercel.app", "https://analitika.vercel.app"];
const results: Record<string, unknown>[] = [];
for (const base of candidates) {
  const origin = new URL(base).origin;
  try {
    const login = await fetch(`${origin}/login`, {
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    const html = await login.text();
    const root = await fetch(origin, { signal: AbortSignal.timeout(15_000), redirect: "manual" });
    const worker = await fetch(`${origin}/api/inngest`, { signal: AbortSignal.timeout(15_000) });
    const raw = await worker.text();
    let workerInfo: Record<string, unknown> = {};
    try {
      workerInfo = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* Non-JSON response. */
    }
    const keys = [
      "app_id",
      "function_count",
      "has_event_key",
      "has_signing_key",
      "mode",
      "sdk_language",
      "sdk_version",
      "authentication_succeeded",
    ];
    results.push({
      origin,
      loginStatus: login.status,
      appBrandMatched: /ZİRVƏ|Zirvə|Analitika|VAHİD ANALİTİK/u.test(html),
      rootStatus: root.status,
      rootRedirectsToLogin: root.headers.get("location")?.startsWith("/login") ?? false,
      workerStatus: worker.status,
      worker: Object.fromEntries(
        keys.filter((key) => key in workerInfo).map((key) => [key, workerInfo[key]]),
      ),
      currentRevisionVerified: false,
      cloudEventDeliveryVerified: false,
    });
  } catch (error) {
    results.push({
      origin,
      status: "unreachable",
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}
const result = {
  checkedAt: new Date().toISOString(),
  targetSource: configured
    ? "configured environment"
    : process.argv.length > 2
      ? "explicit CLI"
      : "candidate URLs from existing project scripts; target not independently confirmed",
  method: "public GET only",
  results,
};
await writeFile("docs/release/RUNTIME_PROBES.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
