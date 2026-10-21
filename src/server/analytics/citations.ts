import { isLowReliability } from "@/lib/reliability";
import type { InfoCredibility, SourceReliability } from "@/lib/reliability";
import { az } from "@/lib/i18n/az";

export type CitationSource = {
  n: number;
  sourceReliability: SourceReliability | null;
  infoCredibility: InfoCredibility | null;
  text?: string;
  documentId?: string | null;
  chunkId?: string;
};

export type ValidatedAnswer = {
  answer: string;
  incomplete: boolean;
  usedLowReliability: boolean;
  evidenceChecks: {
    exactExcerptCount: number;
    unsupportedNumericFactCount: number;
    unanchoredClaimCount: number;
  };
};

function normalizedEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function numericFacts(value: string): string[] {
  return [
    ...value.matchAll(
      /(?:[$€£₼]\s*)?\b\d+(?:[,.]\d+)*(?:\s*(?:trilyon|milyard|milyon|billion|million|trillion|mln|bn|faiz|min|%|m\b|b\b))?/giu,
    ),
  ].map(([fact]) => fact.replace(/\s+/gu, "").toLocaleLowerCase());
}

function claimBeforeCitation(answer: string, citationIndex: number): string {
  const lineStart = answer.lastIndexOf("\n", citationIndex) + 1;
  const line = answer
    .slice(lineStart, citationIndex)
    .replace(/⟦E\d+:\s*[^⟧]+⟧/gu, "")
    .replace(/\[\d+\]/gu, "");
  const lastBoundary = [...line.matchAll(/[.!?;](?!\d)(?:\s+|$)/gu)].at(-1);
  const sentenceStart = lastBoundary ? lastBoundary.index! + lastBoundary[0].length - 1 : -1;
  return line
    .slice(sentenceStart + 1)
    .replace(/^\s*(?:[-*•]\s*)?/u, "")
    .trim();
}

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
  const referenceCounts = new Map<number, number>();
  const evidenceCounts = new Map<number, number>();
  let exactExcerptCount = 0;
  let unsupportedNumericFactCount = 0;
  let incomplete = false;

  // Evidence markers are internal validation material. They are removed from
  // the user-facing answer after the referenced text is verified verbatim.
  const evidenceMarkers = [...answer.matchAll(/⟦E(\d+):\s*([^⟧]+)⟧/gu)];
  const evidencePairs = [...answer.matchAll(/\[(\d+)\]\s*⟦E(\d+):\s*([^⟧]+)⟧/gu)];
  const evidenceFreeInput = answer.replace(/⟦E\d+:\s*[^⟧]+⟧/gu, "");
  if (/[⟦⟧]/u.test(evidenceFreeInput)) incomplete = true;
  if (evidenceMarkers.length !== evidencePairs.length) incomplete = true;
  for (const pair of evidencePairs) {
    const citedNumber = Number(pair[1]);
    const evidenceNumber = Number(pair[2]);
    const excerpt = pair[3]!.trim();
    const source = available.get(citedNumber);
    evidenceCounts.set(evidenceNumber, (evidenceCounts.get(evidenceNumber) ?? 0) + 1);
    if (citedNumber !== evidenceNumber || !source?.text || !excerpt) {
      incomplete = true;
      continue;
    }
    if (!normalizedEvidence(source.text).includes(normalizedEvidence(excerpt))) {
      incomplete = true;
      continue;
    }
    exactExcerptCount += 1;
    const claim = claimBeforeCitation(answer, pair.index ?? 0);
    const sourceFacts = new Set(numericFacts(excerpt));
    const missingFacts = numericFacts(claim).filter((fact) => !sourceFacts.has(fact));
    if (missingFacts.length) {
      unsupportedNumericFactCount += missingFacts.length;
      incomplete = true;
    }
  }

  const cleaned = evidenceFreeInput.replace(
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
        referenceCounts.set(n, (referenceCounts.get(n) ?? 0) + 1);
        validNumbers.push(n);
      }
      return validNumbers.map((n) => `[${n}]`).join("");
    },
  );

  const containsNoSourcesMessage =
    cleaned.trim().toLocaleLowerCase() === az.analytics.noSources.toLocaleLowerCase();
  if (containsNoSourcesMessage && (referenced.size > 0 || evidenceMarkers.length > 0))
    incomplete = true;
  if (referenced.size === 0 && !containsNoSourcesMessage && answer.trim().length > 0)
    incomplete = true;

  for (const [number, count] of referenceCounts) {
    if ((evidenceCounts.get(number) ?? 0) < count) incomplete = true;
  }
  if (evidenceMarkers.length !== evidencePairs.length) incomplete = true;

  const evidenceFreeAnswer = cleaned.replace(/⟦E\d+:\s*[^⟧]+⟧/gu, "");
  let unanchoredClaimCount = 0;
  if (!containsNoSourcesMessage) {
    const claimUnits = evidenceFreeAnswer
      .split(/\r?\n/u)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/u));
    for (const line of claimUnits) {
      const plain = line
        .replace(/^\s*(?:#{1,6}\s*|[-*•]\s*)/u, "")
        .replace(/\[\d+\]/gu, "")
        .replace(/[*_`>#]/gu, "")
        .trim();
      if (
        !plain ||
        /^(qısa nəticə|əsas məqamlar|etibarlılıq qeydi|mənbələr arasında fərqlər və boşluqlar)\s*:?$/iu.test(
          plain,
        )
      )
        continue;
      if (!/\[\d+\]/u.test(line)) {
        unanchoredClaimCount += 1;
        incomplete = true;
      }
    }
  }

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

  return {
    answer: answerWithWarning
      .replace(/\s*⟦E\d+:\s*[^⟧]+⟧/gu, "")
      .replace(/ +([.,;!?])/gu, "$1")
      .trim(),
    incomplete,
    usedLowReliability,
    evidenceChecks: {
      exactExcerptCount,
      unsupportedNumericFactCount,
      unanchoredClaimCount,
    },
  };
}
