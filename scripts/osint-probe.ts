import { GeminiLLMProvider } from "../src/server/ai/gemini";
import { readServerEnv, requireServerEnv } from "../src/server/env";
import { queryExpansionsSchema } from "../src/server/osint/query-expansion";
import { sourceSummaryBatchSchema } from "../src/server/osint/reports";

type ThinkingLevel = "low" | "minimal";
const minimalModels = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite-image",
  "gemini-3-flash-preview",
  "gemini-robotics-er-2-preview",
];

function supportsMinimal(model: string): boolean {
  return minimalModels.some((supported) => model.startsWith(supported));
}

function errorClass(error: unknown): string {
  if (!error || typeof error !== "object") return "other";
  const value = error as Record<string, unknown>;
  const status = Number(value["statusCode"] ?? value["status"] ?? 0);
  if (status === 429) return "rate_limit";
  if (/timeout|abort/i.test(`${String(value["name"] ?? "")} ${String(value["message"] ?? "")}`))
    return "timeout";
  if (/json|structured output/i.test(String(value["message"] ?? ""))) return "invalid_json";
  return "other";
}

function tokenDelta(
  after: Readonly<{ inputTokens: number; outputTokens: number; thinkingTokens?: number }>,
  before: Readonly<{ inputTokens: number; outputTokens: number; thinkingTokens?: number }>,
) {
  return {
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    thinkingTokens: (after.thinkingTokens ?? 0) - (before.thinkingTokens ?? 0),
  };
}

async function measure(
  step: "expansion" | "summary",
  model: string,
  thinkingLevel: ThinkingLevel | undefined,
  provider: GeminiLLMProvider,
) {
  const before = { ...provider.usageStats };
  const started = Date.now();
  let error: string | undefined;
  try {
    if (step === "expansion") {
      await provider.generateObject(
        {
          system:
            "Create concise main queries and distinct variants for the requested search languages. Keep Azerbaijani main identical to the supplied original query.",
          prompt: JSON.stringify({
            query: "regional security analysis",
            languages: ["az", "en", "ru"],
          }),
          temperature: 0.1,
          maxOutputTokens: 500,
          maxAttempts: 1,
          ...(thinkingLevel ? { thinkingLevel } : {}),
        },
        queryExpansionsSchema(["az", "en", "ru"]),
      );
    } else {
      await provider.generateObject(
        {
          system:
            "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.",
          prompt: JSON.stringify({
            sources: [
              {
                number: 1,
                title: "M\u0259lumat\u0131n q\u0131sa icmal\u0131",
                text: "R\u0259smi a\u00e7\u0131qlamada g\u00f6r\u00fc\u015f\u00fcn Bak\u0131da ke\u00e7irildiyi v\u0259 regional \u0259m\u0259kda\u015fl\u0131\u011f\u0131n m\u00fczakir\u0259 olundu\u011fu bildirilib.",
              },
              {
                number: 2,
                title: "T\u0259r\u0259fl\u0259rin m\u00f6vqeyi",
                text: "T\u0259r\u0259fl\u0259r n\u0259qliyyat \u0259laq\u0259l\u0259rinin inki\u015faf\u0131 bar\u0259d\u0259 fikir m\u00fcadil\u0259si apar\u0131b.",
              },
              {
                number: 3,
                title: "Yekun m\u0259lumat",
                text: "N\u00f6vb\u0259ti g\u00f6r\u00fc\u015f\u00fcn tarixi bar\u0259d\u0259 \u0259lav\u0259 m\u0259lumat verilm\u0259yib.",
              },
            ],
          }),
          temperature: 0.1,
          maxOutputTokens: 1_800,
          maxAttempts: 1,
          ...(thinkingLevel ? { thinkingLevel } : {}),
        },
        sourceSummaryBatchSchema,
      );
    }
  } catch (caught) {
    error = errorClass(caught);
  }
  return {
    step,
    model,
    thinkingLevel: thinkingLevel ?? "unset",
    durationMs: Date.now() - started,
    ...tokenDelta(provider.usageStats, before),
    attempts: provider.usageStats.apiCalls - before.apiCalls,
    ...(error ? { error } : {}),
  };
}

async function main() {
  const env = readServerEnv();
  const expansionModel = requireServerEnv("AI_CHAT_MODEL");
  const summaryModel = env.AI_LIGHT_MODEL || expansionModel;
  const results = [];
  for (const [step, model, quotaKey] of [
    ["expansion", expansionModel, "AI_CHAT_MODEL"],
    ["summary", summaryModel, summaryModel === expansionModel ? "AI_CHAT_MODEL" : "AI_LIGHT_MODEL"],
  ] as const) {
    const levels: Array<ThinkingLevel | undefined> = [undefined, "low"];
    if (supportsMinimal(model)) levels.push("minimal");
    for (const level of levels) {
      const provider = new GeminiLLMProvider(model, quotaKey);
      results.push(await measure(step, model, level, provider));
    }
  }
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: errorClass(error) }));
  process.exitCode = 1;
});
