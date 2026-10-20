export type OsintStage = "search" | "summary" | "report" | "incomplete";

const SUMMARY_STEPS = new Set(["summarizing", "summary_retrying"]);

export function osintStage(input: {
  status: string;
  step: string;
  failedSteps: readonly string[];
  sourcesFound: number;
}): OsintStage | undefined {
  if (input.status === "done") return undefined;
  if (input.status === "partial") return input.sourcesFound > 0 ? "incomplete" : "search";
  if (input.status === "failed") {
    if (input.failedSteps.some((label) => /^(synthesizing|report:)/.test(label))) return "report";
    if (input.failedSteps.some((label) => /^(summarizing|summary_retry)/.test(label))) {
      return "summary";
    }
    return "search";
  }
  if (SUMMARY_STEPS.has(input.step)) return "summary";
  if (input.step === "synthesizing") return "report";
  return "search";
}
