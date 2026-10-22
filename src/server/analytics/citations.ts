import { isLowReliability } from "@/lib/reliability";
import type { InfoCredibility, SourceReliability } from "@/lib/reliability";

export type CitationSource = {
  n: number;
  sourceReliability: SourceReliability | null;
  infoCredibility: InfoCredibility | null;
  text?: string;
  documentId?: string | null;
  chunkId?: string;
};

export type CitationFailureReason = "unknown_citation" | "invalid_citation_range";

export type ValidatedAnswer = {
  answer: string;
  incomplete: boolean;
  usedLowReliability: boolean;
  failureReasons: CitationFailureReason[];
};

type PublicationValidation = Pick<ValidatedAnswer, "incomplete"> &
  Partial<Pick<ValidatedAnswer, "failureReasons">>;

function cleanAnswer(answer: string): string {
  return (
    answer
      // Legacy internal annotations are optional and never user-facing.
      .replace(/[ \t]*⟦\s*E[\s\S]*?(?:⟧|$)/giu, "")
      // A model URL must not determine the destination of a numbered citation.
      .replace(/\[(\s*\d+(?:\s*[,;–—-]\s*\d+)*\s*)\]\([^\r\n)]*\)/gu, "[$1]")
      .trim()
  );
}

export function analyticsPublicationFailureReasons(
  answer: string,
  finishReason: string,
  validation: PublicationValidation,
): string[] {
  const reasons: string[] = [];
  const text = cleanAnswer(answer);
  if (!/[\p{L}\p{N}]/u.test(text.replace(/\[\s*\d+(?:\s*[,;–—-]\s*\d+)*\s*\]/gu, "")))
    reasons.push("empty_answer");
  if (finishReason !== "stop") reasons.push("non_stop_finish");
  if (validation.incomplete)
    reasons.push(
      ...(validation.failureReasons?.length ? validation.failureReasons : ["invalid_citations"]),
    );
  if (text.lastIndexOf("[") > text.lastIndexOf("]") || /\[\s*\d+\s*\]\([^)]*$/u.test(text))
    reasons.push("open_citation");
  return reasons;
}

export function canPublishAnalyticsAnswer(
  answer: string,
  finishReason: string,
  validation: PublicationValidation,
): boolean {
  return analyticsPublicationFailureReasons(answer, finishReason, validation).length === 0;
}

/** Sources must come from the server's live authorization/retrieval access checks. */
export function validateCitations(
  answer: string,
  sources: readonly CitationSource[],
  lowReliabilityWarning: string,
): ValidatedAnswer {
  const available = new Map(sources.map((source) => [source.n, source]));
  const referenced = new Set<number>();
  const failureReasons = new Set<CitationFailureReason>();
  const cleaned = cleanAnswer(answer).replace(
    /\[\s*(\d+(?:\s*[,;–—-]\s*\d+)*)\s*\]/gu,
    (_citation, raw: string) => {
      const numbers: number[] = [];
      for (const part of raw.split(/\s*[,;]\s*/u)) {
        const range = /^(\d+)\s*[–—-]\s*(\d+)$/u.exec(part);
        if (range) {
          const start = Number(range[1]);
          const end = Number(range[2]);
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            end < start ||
            end - start > 100
          ) {
            failureReasons.add("invalid_citation_range");
            continue;
          }
          for (let n = start; n <= end; n += 1) numbers.push(n);
        } else {
          numbers.push(Number(part.trim()));
        }
      }

      const valid = new Set<number>();
      for (const n of numbers) {
        if (!Number.isSafeInteger(n) || !available.has(n)) {
          failureReasons.add("unknown_citation");
          continue;
        }
        referenced.add(n);
        valid.add(n);
      }
      return [...valid].map((n) => `[${n}]`).join("");
    },
  );

  const usedLowReliability = [...referenced].some((n) => {
    const source = available.get(n)!;
    return source.sourceReliability && source.infoCredibility
      ? isLowReliability(source.sourceReliability, source.infoCredibility)
      : false;
  });
  const warning = lowReliabilityWarning.trim();
  const answerWithWarning =
    usedLowReliability &&
    warning &&
    !cleaned.toLocaleLowerCase().includes(warning.toLocaleLowerCase())
      ? cleaned.trimEnd() + "\n\n" + warning + "."
      : cleaned;

  return {
    answer: answerWithWarning.replace(/ +([.,;!?])/gu, "$1").trim(),
    incomplete: failureReasons.size > 0,
    usedLowReliability,
    failureReasons: [...failureReasons],
  };
}
