import { isLowReliability } from "@/lib/reliability";
import type { InfoCredibility, SourceReliability } from "@/lib/reliability";
import { az } from "@/lib/i18n/az";

export type CitationSource = {
  n: number;
  sourceReliability: SourceReliability | null;
  infoCredibility: InfoCredibility | null;
};

export type ValidatedAnswer = {
  answer: string;
  incomplete: boolean;
  usedLowReliability: boolean;
};

export function canPublishAnalyticsAnswer(
  answer: string,
  finishReason: string,
  validation: Pick<ValidatedAnswer, "incomplete">,
): boolean {
  const text = answer.trim();
  if (!text || finishReason !== "stop" || validation.incomplete) return false;
  return text.lastIndexOf("[") <= text.lastIndexOf("]");
}

export function validateCitations(
  answer: string,
  sources: readonly CitationSource[],
  lowReliabilityWarning: string,
): ValidatedAnswer {
  const available = new Map(sources.map((source) => [source.n, source]));
  const referenced = new Set<number>();
  let incomplete = false;
  const cleaned = answer.replace(
    /\[\s*(\d+(?:\s*[,;–—-]\s*\d+)*)\s*\]/g,
    (_citation, raw: string) => {
      const numbers: number[] = [];
      for (const part of raw.split(/\s*[,;]\s*/)) {
        const range = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(part);
        if (range) {
          const start = Number(range[1]);
          const end = Number(range[2]);
          if (end < start || end - start > 100) {
            incomplete = true;
            continue;
          }
          for (let n = start; n <= end; n += 1) numbers.push(n);
        } else {
          const n = Number(part.trim());
          if (Number.isSafeInteger(n)) numbers.push(n);
        }
      }

      const validNumbers: number[] = [];
      const seen = new Set<number>();
      for (const n of numbers) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!available.has(n)) {
          incomplete = true;
          continue;
        }
        referenced.add(n);
        validNumbers.push(n);
      }
      return validNumbers.map((n) => `[${n}]`).join("");
    },
  );

  const containsNoSourcesMessage =
    cleaned.trim().toLocaleLowerCase() === az.analytics.noSources.toLocaleLowerCase();
  if (referenced.size === 0 && !containsNoSourcesMessage && answer.trim().length > 0)
    incomplete = true;

  const usedLowReliability = [...referenced].some((n) => {
    const source = available.get(n);
    return source && source.sourceReliability && source.infoCredibility
      ? isLowReliability(source.sourceReliability, source.infoCredibility)
      : false;
  });
  const normalizedWarning = lowReliabilityWarning.trim();
  const answerWithWarning =
    usedLowReliability &&
    normalizedWarning.length > 0 &&
    !cleaned.toLocaleLowerCase().includes(normalizedWarning.toLocaleLowerCase())
      ? cleaned.trimEnd() + "\n\n" + normalizedWarning + "."
      : cleaned;

  return { answer: answerWithWarning, incomplete, usedLowReliability };
}
