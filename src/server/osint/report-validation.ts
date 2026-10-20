import type { SourceRelevance, StoredStructuredReport } from "./reports";

export type ReportRecord = {
  number: number;
  title: string;
  summary: string;
  claims: string[];
  entities: string[];
  eventDate: string | null;
  publicationDate: string | null;
  relevance: SourceRelevance;
};

type CitedFinding = { text: string; sourceNumbers: number[] };

const STOPWORDS = [
  "üçün",
  "kimi",
  "olan",
  "olub",
  "olunub",
  "edib",
  "edir",
  "edilib",
  "edilir",
  "bildirib",
  "bildirilir",
  "deyib",
  "görə",
  "daha",
  "həmçinin",
  "bununla",
  "belə",
  "lakin",
  "ancaq",
  "isə",
  "çox",
  "bütün",
  "digər",
  "yazıb",
  "qeyd",
  "olduğu",
  "olduğunu",
  "etdi",
  "edən",
  "sonra",
  "əvvəl",
  "zaman",
  "məlumat",
  "mənbə",
  "mənbələr",
  "xəbər",
  "haqqında",
  "barədə",
  "əsasən",
  "bəzi",
  "bildirir",
  "göstərir",
  "olur",
  "olar",
  "olacaq",
];

const MIN_SHARED_STEMS = 2;
const MIN_SHARED_RATIO = 0.25;
const MIN_BLUF_SENTENCE_WORDS = 6;
const GENERIC_PHRASES =
  /müxtəlif\s+(məlumat|mənbə|fikir|yanaşma|mövqe|xəbər|rəy)|bir\s+sıra\s+(məlumat|mənbə|xəbər)|məlumatlar\s+dərc|mənbələrdə\s+müxtəlif|müxtəlif\s+qiymətləndirmə/iu;

function lower(value: string): string {
  return value.toLocaleLowerCase("az");
}

function stem(token: string): string {
  const value = lower(token);
  return /^\p{N}+$/u.test(value) ? value : value.slice(0, 5);
}

const stopStems = new Set(STOPWORDS.map(stem));

export function stripCitations(text: string): string {
  return text
    .replace(/\[\d+(?:\s*[,;]\s*\d+)*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.!?…,;:])/g, "$1")
    .trim();
}

export function splitSentences(text: string): string[] {
  const clean = stripCitations(text);
  const output: string[] = [];
  let start = 0;
  const boundary = /([.!?…])\s+(?=[\p{Lu}\p{N}"«„(])/gu;
  for (const match of clean.matchAll(boundary)) {
    const end = (match.index ?? 0) + 1;
    if (match[1] === ".") {
      const lastWord = clean.slice(start, end - 1).match(/[\p{L}\p{N}]+$/u)?.[0] ?? "";
      if (lastWord.length <= 2) continue;
    }
    output.push(clean.slice(start, end).trim());
    start = end;
  }
  const rest = clean.slice(start).trim();
  if (rest) output.push(rest);
  return output.filter(Boolean);
}

type Tokens = { stems: Set<string>; names: Set<string>; numerals: Set<string>; words: number };

function tokenize(text: string, entityStems: ReadonlySet<string> = new Set()): Tokens {
  const stems = new Set<string>();
  const nameOccurrences = new Map<string, boolean>();
  const numerals = new Set<string>();
  let words = 0;
  for (const sentence of splitSentences(text)) {
    const tokens = sentence.match(/[\p{L}\p{N}]+/gu) ?? [];
    tokens.forEach((token, index) => {
      words += 1;
      const isNumeral = /^\p{N}+$/u.test(token);
      if (isNumeral) {
        if (token.length >= 2) {
          numerals.add(token);
          stems.add(token);
        }
        return;
      }
      if (token.length < 4) return;
      const tokenStem = stem(token);
      if (stopStems.has(tokenStem)) return;
      stems.add(tokenStem);
      const capitalized = /^\p{Lu}/u.test(token);
      const isName = capitalized && (index > 0 || entityStems.has(tokenStem));
      nameOccurrences.set(tokenStem, (nameOccurrences.get(tokenStem) ?? true) && isName);
    });
  }
  const names = new Set([...nameOccurrences].filter(([, isName]) => isName).map(([key]) => key));
  return { stems, names, numerals, words };
}

function recordText(record: ReportRecord): string {
  return [
    record.title,
    record.summary,
    ...record.claims,
    ...record.entities,
    record.eventDate ?? "",
    record.publicationDate ?? "",
  ].join(" . ");
}

function haystack(records: readonly ReportRecord[]): { stems: Set<string>; numerals: Set<string> } {
  const stems = new Set<string>();
  const numerals = new Set<string>();
  for (const record of records) {
    const tokens = tokenize(recordText(record));
    for (const value of tokens.stems) stems.add(value);
    for (const value of tokens.numerals) numerals.add(value);
  }
  return { stems, numerals };
}

function supported(claim: Tokens, records: readonly ReportRecord[]): boolean {
  if (!records.length || !claim.stems.size) return false;
  const evidence = haystack(records);
  const shared = [...claim.stems].filter((value) => evidence.stems.has(value));
  if (shared.length < MIN_SHARED_STEMS) return false;
  if (!shared.some((value) => !claim.names.has(value))) return false;
  if (shared.length / claim.stems.size < MIN_SHARED_RATIO) return false;
  if (claim.numerals.size && [...claim.numerals].every((value) => !evidence.numerals.has(value))) {
    return false;
  }
  return true;
}

export function claimSupportedBy(text: string, records: readonly ReportRecord[]): boolean {
  return supported(tokenize(text), records);
}

export function supportingSourceNumbers(
  text: string,
  numbers: readonly number[],
  recordsByNumber: ReadonlyMap<number, ReportRecord>,
): number[] {
  const unique = [...new Set(numbers)].filter((number) => recordsByNumber.has(number));
  const claim = tokenize(text);
  const individually = unique.filter((number) => supported(claim, [recordsByNumber.get(number)!]));
  if (individually.length) return individually;
  const all = unique.map((number) => recordsByNumber.get(number)!);
  return unique.length > 1 && supported(claim, all) ? unique : [];
}

export type BlufCheck = { valid: boolean; sourceNumbers: number[]; reasons: string[] };

export function validateBluf(
  bluf: string,
  numbers: readonly number[],
  records: readonly ReportRecord[],
): BlufCheck {
  const recordsByNumber = new Map(records.map((record) => [record.number, record]));
  const cited = [...new Set(numbers)]
    .map((number) => recordsByNumber.get(number))
    .filter((record): record is ReportRecord => Boolean(record));
  const reasons: string[] = [];
  if (!cited.length) return { valid: false, sourceNumbers: [], reasons: ["no_citations"] };
  const sentences = splitSentences(bluf);
  if (sentences.length < 2 || sentences.length > 3) reasons.push("sentence_count");
  const entityStems = new Set(
    cited.flatMap((record) => [...tokenize(record.entities.join(" . ")).stems]),
  );
  const linked = new Set<number>();
  for (const sentence of sentences) {
    const tokens = tokenize(sentence, entityStems);
    const concrete =
      tokens.numerals.size > 0 ||
      tokens.names.size > 0 ||
      [...tokens.stems].some((value) => entityStems.has(value));
    if (tokens.words < MIN_BLUF_SENTENCE_WORDS || !concrete) reasons.push("not_concrete");
    else if (GENERIC_PHRASES.test(sentence) && tokens.names.size + tokens.numerals.size < 2) {
      reasons.push("generic");
    }
    if (!supported(tokens, cited)) reasons.push("unsupported");
    for (const record of cited) if (supported(tokens, [record])) linked.add(record.number);
  }
  const sourceNumbers = cited.filter((record) => linked.has(record.number)).map((r) => r.number);
  if (!sourceNumbers.length) reasons.push("no_linked_source");
  const hasDirect = records.some((record) => record.relevance === "direct");
  if (
    hasDirect &&
    sourceNumbers.length &&
    !sourceNumbers.some((number) => recordsByNumber.get(number)?.relevance === "direct")
  ) {
    reasons.push("no_direct_source");
  }
  return { valid: reasons.length === 0, sourceNumbers, reasons: [...new Set(reasons)] };
}

export type ValidatedFindings = { supported: CitedFinding[]; weak: { text: string }[] };

export function validateFindings(
  findings: readonly CitedFinding[],
  records: readonly ReportRecord[],
): ValidatedFindings {
  const recordsByNumber = new Map(records.map((record) => [record.number, record]));
  const output: ValidatedFindings = { supported: [], weak: [] };
  for (const finding of findings) {
    const numbers = supportingSourceNumbers(finding.text, finding.sourceNumbers, recordsByNumber);
    if (numbers.length) output.supported.push({ text: finding.text, sourceNumbers: numbers });
    else output.weak.push({ text: finding.text });
  }
  return output;
}

export function fallbackBluf(
  findings: readonly CitedFinding[],
  records: readonly ReportRecord[],
): { bluf: string; sourceNumbers: number[] } | null {
  const eligibleRecords = reportableRecords(records);
  const recordsByNumber = new Map(eligibleRecords.map((record) => [record.number, record]));
  const relevance = new Map(eligibleRecords.map((record) => [record.number, record.relevance]));
  const direct = findings.filter((finding) =>
    finding.sourceNumbers.some((number) => relevance.get(number) === "direct"),
  );
  const orderedFindings = [...direct, ...findings.filter((finding) => !direct.includes(finding))];
  const candidates: Array<{ text: string; sourceNumbers: number[] }> = [];
  const seen = new Set<string>();
  for (const finding of orderedFindings) {
    for (const rawText of splitSentences(finding.text)) {
      const text = /[.!?…]$/.test(rawText) ? rawText : `${rawText}.`;
      const key = lower(text);
      if (seen.has(key)) continue;
      const sourceNumbers = supportingSourceNumbers(text, finding.sourceNumbers, recordsByNumber);
      if (!sourceNumbers.length) continue;
      seen.add(key);
      candidates.push({ text, sourceNumbers });
    }
  }

  for (const size of [2, 3]) {
    const chosen: Array<{ text: string; sourceNumbers: number[] }> = [];
    let result: { bluf: string; sourceNumbers: number[] } | null = null;
    const visit = (start: number) => {
      if (result) return;
      if (chosen.length === size) {
        const bluf = chosen.map((item) => item.text).join(" ");
        const numbers = [...new Set(chosen.flatMap((item) => item.sourceNumbers))];
        const validation = validateBluf(bluf, numbers, eligibleRecords);
        if (validation.valid) result = { bluf, sourceNumbers: validation.sourceNumbers };
        return;
      }
      const remaining = size - chosen.length;
      for (let index = start; index <= candidates.length - remaining; index += 1) {
        chosen.push(candidates[index]!);
        visit(index + 1);
        chosen.pop();
        if (result) return;
      }
    };
    visit(0);
    if (result) return result;
  }
  return null;
}

export type ValidatedReport = {
  report: StoredStructuredReport;
  bluf: BlufCheck;
  supportedFindings: number;
  weakFindings: number;
};

export function validateReport(
  report: StoredStructuredReport,
  records: readonly ReportRecord[],
): ValidatedReport {
  const findings = validateFindings(report.keyFindings, records);
  const bluf = validateBluf(report.bluf, report.blufSourceNumbers, records);
  return {
    report: {
      ...report,
      blufSourceNumbers: bluf.valid ? bluf.sourceNumbers : report.blufSourceNumbers,
      keyFindings: findings.supported,
      weakFindings: findings.weak,
    },
    bluf,
    supportedFindings: findings.supported.length,
    weakFindings: findings.weak.length,
  };
}

export function finalizeReport(
  validated: ValidatedReport,
  records: readonly ReportRecord[],
): { report: StoredStructuredReport; usedFallback: boolean } | null {
  if (validated.bluf.valid) return { report: validated.report, usedFallback: false };
  const fallback = fallbackBluf(validated.report.keyFindings, records);
  if (!fallback) return null;
  return {
    report: {
      ...validated.report,
      bluf: fallback.bluf,
      blufSourceNumbers: fallback.sourceNumbers,
    },
    usedFallback: true,
  };
}

export function reportableRecords<T extends { relevance: SourceRelevance }>(
  records: readonly T[],
): T[] {
  return records.filter((record) => record.relevance !== "offtopic");
}
