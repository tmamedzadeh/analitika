/** One public synthetic generation sample for human semantic review after retry-budget changes. */
import { writeFile } from "node:fs/promises";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { buildAnalyticsPrompt } from "../src/server/prompts/analytics";
import { canPublishAnalyticsAnswer, validateCitations } from "../src/server/analytics/citations";
import type { AnalyticsSource } from "../src/lib/analytics";
import { getGeminiFailureInfo } from "../src/server/ai/gemini-gateway";

const text =
  "Açıq sintetik yoxlama paketi 42 vahiddən ibarətdir. Qeyd tarixi 21 oktyabr 2026-cı ildir. Bu məlumat uydurulmuş test nümunəsidir.";
const source: AnalyticsSource = {
  n: 1,
  sourceKind: "document",
  documentId: crypto.randomUUID(),
  briefId: null,
  chunkId: crypto.randomUUID(),
  title: "Açıq sintetik test",
  docDate: "2026-10-21",
  briefDate: null,
  direction: "OSINT",
  sectionTitle: "Sintetik faktlar",
  text,
  quote: text,
  charStart: 0,
  charEnd: text.length,
  isTable: false,
  attachmentCount: 0,
  sourceReliability: "A",
  infoCredibility: 1,
  classification: "open",
};
try {
  const provider = createGeminiProviders().analytics;
  const prompt = buildAnalyticsPrompt(
    "Açıq sintetik yoxlama paketində neçə vahid var və hansı tarixdə qeydə alınıb?",
    [source],
    "low",
  );
  const attempts = [];
  let result!: { text: string; finishReason: string; model?: string };
  let validation!: ReturnType<typeof validateCitations>;
  for (let attempt = 0; attempt < 2; attempt++) {
    result = await provider.generateTextWithMetadata({
      ...prompt,
      ...(attempt
        ? {
            system:
              prompt.system +
              "\nTam cavab yaz və yalnız təqdim edilmiş mənbə nömrələrinə istinad et.",
          }
        : {}),
      maxAttempts: 2,
      timeoutMs: 60_000,
    });
    validation = validateCitations(result.text, [source]);
    const publishable = canPublishAnalyticsAnswer(result.text, result.finishReason, validation);
    attempts.push({
      attempt: attempt + 1,
      publishable,
      validationFailureReasons: validation.failureReasons,
    });
    if (publishable) break;
  }
  const publishable = canPublishAnalyticsAnswer(result.text, result.finishReason, validation);
  if (!publishable) process.exitCode = 1;
  await writeFile(
    ".release-backup.local/semantic-sample.json",
    JSON.stringify(
      {
        source: text,
        answer: result.text,
        cleaned: validation.answer,
        finishReason: result.finishReason,
      },
      null,
      2,
    ),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    model: result.model ?? provider.model,
    externalInput: "explicitly open, inline fictional sample only; no corpus or closed text",
    purpose:
      "Human semantic spot check after SDK retry/deadline fixes; earlier 3-case live generation evidence preserved",
    finishReason: result.finishReason,
    status: publishable ? "PASS" : "FAIL",
    publishable,
    attempts,
    validationFailureReasons: validation.failureReasons,
    semanticReview:
      "NOT VERIFIED until human-style inspection; structural checks are not entailment",
  };
  await writeFile("docs/release/SEMANTIC_SAMPLE.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  process.exitCode = 1;
  const raw = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  let providerErrorStatus: string | undefined;
  let thinkingConfigRejected = false;
  let modelUnavailable = false;
  try {
    const body = JSON.parse(typeof raw["responseBody"] === "string" ? raw["responseBody"] : "{}");
    if (typeof body.error?.status === "string" && /^[A-Z_]{1,64}$/.test(body.error.status))
      providerErrorStatus = body.error.status;
    const message = typeof body.error?.message === "string" ? body.error.message : "";
    thinkingConfigRejected = /thinking/i.test(message);
    modelUnavailable = /model.*(?:not found|not supported|unavailable)|not found.*model/i.test(
      message,
    );
  } catch {
    /* Never emit the raw provider body. */
  }
  const report = {
    checkedAt: new Date().toISOString(),
    status: "FAIL",
    errorType: error instanceof Error ? error.name : "unknown",
    ...getGeminiFailureInfo(error),
    providerErrorStatus,
    thinkingConfigRejected,
    modelUnavailable,
    semanticReview: "NOT VERIFIED: live sample failed before response",
    previousGenerationEvidence:
      "Historical 3-case PASS retained; not proof of current provider availability",
  };
  await writeFile("docs/release/SEMANTIC_SAMPLE.json", JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report, null, 2));
}
