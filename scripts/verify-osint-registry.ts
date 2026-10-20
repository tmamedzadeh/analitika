import { SOURCE_REGISTRY } from "../src/server/osint/source-registry";

const domains = [...new Set(SOURCE_REGISTRY.map((source) => source.domain))];

async function check(domain: string): Promise<{ domain: string; status: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://${domain}`, {
      method: "GET",
      headers: { Accept: "*/*", "Accept-Encoding": "identity", Range: "bytes=0-0" },
      redirect: "follow",
      signal: controller.signal,
    });
    await response.body?.cancel();
    const status =
      response.status === 404 || response.status === 410 || response.status >= 500
        ? `unavailable:${response.status}`
        : String(response.status);
    return { domain, status };
  } catch (error) {
    return {
      domain,
      status: error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const results: Array<{ domain: string; status: string }> = [];
for (let index = 0; index < domains.length; index += 5) {
  results.push(...(await Promise.all(domains.slice(index, index + 5).map(check))));
}
for (const result of results) console.log(`${result.domain}\t${result.status}`);
if (
  results.some(
    (result) =>
      result.status.startsWith("unavailable:") ||
      result.status === "unreachable" ||
      result.status === "timeout",
  )
) {
  process.exitCode = 1;
}
