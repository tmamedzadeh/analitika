/** Test subprocess only. Never imported by the application or production bundle. */
import { writeFile } from "node:fs/promises";
import { az } from "../src/lib/i18n/az";

if (process.env["RELEASE_CONTROLLED_AI"] !== "synthetic-only")
  throw new Error("Controlled provider requires explicit test subprocess.");
const token = process.env["RELEASE_CONTROLLED_RUN_ID"];
if (!token || !/^rc[a-f0-9]{32}$/.test(token)) throw new Error("Missing synthetic run token.");
const realFetch = globalThis.fetch;
const counts: Record<string, number> = {};
async function pause(ms: number, signal?: AbortSignal | null) {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "generativelanguage.googleapis.com") return realFetch(input, init);
  const body = typeof init?.body === "string" ? init.body : "";
  if (!body.includes(token)) throw new Error("Controlled provider refuses non-fixture input.");
  const scenario =
    ["rcdeadline", "rccancel", "rcmalformed", "rcretry", "rcembedoutage", "rcquota"].find((value) =>
      body.includes(value),
    ) ?? "other";
  const kind = url.pathname.includes("embedContent") ? "embedding" : "generation";
  const key = `${scenario}_${kind}`;
  counts[key] = (counts[key] ?? 0) + 1;
  await writeFile(".release-backup.local/controlled-ai-counts.json", JSON.stringify(counts));
  if (kind === "embedding") {
    if (scenario === "rcembedoutage")
      return Response.json(
        { error: { code: 429, message: "Synthetic quota" } },
        { status: 429, headers: { "retry-after": "45" } },
      );
    return Response.json({
      embedding: { values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)) },
    });
  }
  if (scenario === "rcquota" && url.pathname.includes("gemini-3.8-flash"))
    return Response.json(
      { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic quota" } },
      { status: 429, headers: { "retry-after": "45" } },
    );
  if (scenario === "rccancel" || (scenario === "rcdeadline" && counts[key]! > 1))
    await pause(120_000, init?.signal);
  if (scenario === "rcdeadline" && counts[key] === 1) await pause(55_000, init?.signal);
  const malformed =
    scenario === "rcmalformed" ||
    scenario === "rcdeadline" ||
    (scenario === "rcretry" && counts[key] === 1);
  return Response.json({
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: malformed ? "Synthetic invalid claim [999]" : az.analytics.noSources }],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });
}) as typeof fetch;
