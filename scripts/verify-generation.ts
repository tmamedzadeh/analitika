/** Live generation on open sources only; emits validation metrics, never answers or excerpts. */
import { writeFile } from "node:fs/promises";
import { closeDb } from "../src/server/db";
import {
  withProjectEvaluationUser,
  requireProjectEvaluationDatabase,
} from "../src/server/evaluation-safety";
import { searchDocumentChunks } from "../src/server/analytics/search";
import {
  withAnalyticsSourceAccess,
  sameAnalyticsSourceSet,
} from "../src/server/analytics/source-access";
import { getCurrentUser } from "../src/server/auth";
import { directionIds } from "../src/lib/directions";
import { createGeminiProviders } from "../src/server/ai/gemini";
import { assertExternalAiClassification } from "../src/server/ai/processing-policy";
import { validateCitations, canPublishAnalyticsAnswer } from "../src/server/analytics/citations";
import { buildAnalyticsPrompt } from "../src/server/prompts/analytics";
import { az } from "../src/lib/i18n/az";

requireProjectEvaluationDatabase();
const filters = {
  period: "all" as const,
  directionIds: [...directionIds],
  minSourceReliability: "all" as const,
  minInfoCredibility: "all" as const,
};
const cases = [
  {
    id: "answerable-numeric",
    query: "Rusiyanın 2027-ci il müdafiə büdcəsi neçə trilyon rubl olacaq?",
    noAnswer: false,
  },
  {
    id: "no-answer-export",
    query: "Azərbaycan 2025 günəbaxan yağı ixracı nə qədərdir?",
    noAnswer: true,
  },
  {
    id: "no-answer-health",
    query: "Bakı dövlət xəstəxanalarında qrip peyvəndinin rəsmi göstəricisi nədir?",
    noAnswer: true,
  },
];
const results: Record<string, unknown>[] = [];
try {
  for (const item of cases) {
    const started = Date.now();
    const result = await withProjectEvaluationUser(async () => {
      const sources = await searchDocumentChunks(item.query, filters, { enableRerank: false });
      return withAnalyticsSourceAccess(sources, getCurrentUser().id, async (available) => {
        if (!sameAnalyticsSourceSet(sources, available)) throw new Error("Source access changed.");
        for (const source of available) {
          if (source.classification !== "open")
            throw new Error("Live generation probe accepts open sources only.");
          assertExternalAiClassification(source.classification);
        }
        const prompt = buildAnalyticsPrompt(item.query, available);
        const provider = createGeminiProviders().analytics;
        let attempts = 0;
        let validation: ReturnType<typeof validateCitations> | undefined;
        let finishReason = "";
        for (; attempts < 2; attempts++) {
          const generated = await provider.generateTextWithMetadata({
            ...prompt,
            timeoutMs: 45_000,
            maxAttempts: 1,
            ...(attempts
              ? {
                  system:
                    prompt.system +
                    "\nHər faktiki cümləni dəqiq istinad və fasiləsiz, sözbəsöz sübutla əsaslandır. Sübut yoxdursa, yalnız təyin olunmuş məlumatsızlıq cümləsini yaz.",
                }
              : {}),
          });
          validation = validateCitations(generated.text, available, prompt.lowReliabilityWarning);
          finishReason = generated.finishReason;
          if (canPublishAnalyticsAnswer(generated.text, finishReason, validation)) {
            attempts++;
            break;
          }
        }
        const noAnswer = validation?.answer.trim() === az.analytics.noSources;
        const publishable = validation
          ? canPublishAnalyticsAnswer(validation.answer, finishReason, validation)
          : false;
        return {
          id: item.id,
          expectedNoAnswer: item.noAnswer,
          actualNoAnswer: noAnswer,
          sourceCount: available.length,
          publishable,
          evidenceChecks: validation?.evidenceChecks,
          attempts,
          status: publishable && noAnswer === item.noAnswer ? "PASS" : "FAIL",
          elapsedMs: Date.now() - started,
        };
      });
    });
    results.push(result.value);
    console.log(JSON.stringify(result.value));
  }
} catch (error) {
  results.push({ status: "FAIL", errorType: error instanceof Error ? error.name : "unknown" });
  process.exitCode = 1;
} finally {
  if (results.some((row) => row["status"] !== "PASS")) process.exitCode = 1;
  await writeFile(
    "docs/release/GENERATION_INTEGRATION.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sourcesPolicy:
          "open only; text sent to configured Gemini provider under audit authorization",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  await closeDb();
}
