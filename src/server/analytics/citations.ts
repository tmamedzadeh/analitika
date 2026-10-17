import { isLowReliability } from "@/lib/reliability";
import type { InfoCredibility, SourceReliability } from "@/lib/reliability";

export type CitationSource = {
  n: number;
  sourceReliability: SourceReliability;
  infoCredibility: InfoCredibility;
};

export type ValidatedAnswer = {
  answer: string;
  incomplete: boolean;
  usedLowReliability: boolean;
};

export function validateCitations(
  answer: string,
  sources: readonly CitationSource[],
  lowReliabilityWarning: string,
): ValidatedAnswer {
  const available = new Map(sources.map((source) => [source.n, source]));
  const referenced = new Set<number>();
  let incomplete = false;
  const cleaned = answer.replace(/\[(\d+)\]/g, (citation, rawNumber: string) => {
    const n = Number(rawNumber);
    const source = available.get(n);
    if (!source) {
      incomplete = true;
      return "";
    }
    referenced.add(n);
    return citation;
  });

  const usedLowReliability = [...referenced].some((n) => {
    const source = available.get(n);
    return source ? isLowReliability(source.sourceReliability, source.infoCredibility) : false;
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
