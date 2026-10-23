/** Read-only synthetic review: imports no provider, database client, storage or worker. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { phase4ContextCases, ordinaryContextCase } from "../src/test/fixtures/phase-4-context";
import {
  additionalContextPayload,
  selectAuxiliaryContext,
  textBytes,
} from "../src/server/analytics/context-selection";
import { buildAnalyticsPrompt } from "../src/server/prompts/analytics";

globalThis.fetch = async () => {
  throw new Error("Synthetic context review forbids network");
};
const results = [...phase4ContextCases(), ordinaryContextCase()].map((scenario) => {
  const auxiliary = selectAuxiliaryContext(scenario.sources, scenario.primary, scenario.neighbors);
  if ("expected" in scenario) assert.equal(auxiliary.length, scenario.expected);
  const base = scenario.sources.map((source) => source.text).join("");
  const payload = additionalContextPayload(scenario.sources, auxiliary);
  assert.ok(
    payload.length <= base.length * 0.2 &&
      textBytes(payload) <= Math.min(2400, textBytes(base) * 0.2),
  );
  const prompt = buildAnalyticsPrompt(
    "Yalnız sintetik ssenarini təhlil et.",
    scenario.sources,
    "medium",
    auxiliary,
  );
  assert.ok(!prompt.prompt.includes("777") && !prompt.prompt.includes("999"));
  return {
    id: scenario.id,
    description: scenario.description,
    primaryChunks: scenario.sources.length,
    auxiliaryChunks: auxiliary.length,
    baseChars: base.length,
    additionalChars: payload.length,
    additionalBytes: textBytes(payload),
    increasePercent: +((payload.length / base.length) * 100).toFixed(2),
    excerpts: auxiliary.map((item) => ({ position: item.position, text: item.text })),
    conclusion: auxiliary.length
      ? "Only boundary interpretation/restatement; no independent added fact or proven model-quality gain"
      : "Safe baseline; no expansion",
  };
});
await writeFile(
  "docs/release/PHASE_4_CONTEXT_REVIEW.json",
  JSON.stringify(
    {
      status: "PASS",
      providerCalls: 0,
      databaseCalls: 0,
      tokenMeasurement:
        "Exact provider token overhead not measured. Bounds cover characters/UTF-8 bytes, including instructions.",
      caveat:
        "Hand-selected synthetic cases are not a corpus hit-rate or semantic-quality benchmark; protection was not weakened.",
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `PASS: ${results.length} synthetic context scenarios; ${results.filter((result) => result.auxiliaryChunks > 0).length} expanded`,
);
