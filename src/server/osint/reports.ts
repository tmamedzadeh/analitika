import { z } from "zod";
import { az } from "@/lib/i18n/az";
import { isAzerbaijaniSummaryContent, looksAzerbaijani } from "./language";

export const AZERBAIJANI_OUTPUT_RULE =
  "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.";

export const SUMMARY_STATUSES = [
  "unavailable",
  "insufficient_text",
  "generation_failed",
  "invalid_output",
] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];
export const sourceRelevanceSchema = z.enum(["direct", "tangential", "offtopic"]);
export type SourceRelevance = z.infer<typeof sourceRelevanceSchema>;

const sourceSummaryFields = {
  number: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(1600),
  claims: z.array(z.string().trim().min(1).max(500)).max(3),
  entities: z.array(z.string().trim().min(1).max(160)).max(20),
  eventDate: z.string().trim().min(1).max(60).nullable(),
  publicationDate: z.string().trim().min(1).max(60).nullable(),
  quote: z.string().trim().min(1).max(500).nullable(),
};

export const sourceSummarySchema = z
  .object({ ...sourceSummaryFields, relevance: sourceRelevanceSchema })
  .strict()
  .describe(
    "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.",
  );

export type SourceSummary = z.infer<typeof sourceSummarySchema>;

export const sourceSummaryStoredSchema = z
  .object({ ...sourceSummaryFields, relevance: sourceRelevanceSchema.optional() })
  .strict();

export type SummaryOutputFailure =
  "generation_failed" | "invalid_json" | "schema" | "language" | "source_number" | "missing";

export type ParsedSourceSummaries = {
  summaries: SourceSummary[];
  failures: Map<number, SummaryOutputFailure>;
};

export const sourceSummaryBatchSchema = z
  .object({
    sources: z.array(z.unknown()).min(1).max(5),
  })
  .strict()
  .describe(
    "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.",
  );

export const simplifiedSourceSummaryBatchSchema = z
  .object({
    sources: z.array(z.unknown()).min(1).max(5),
  })
  .strict()
  .describe(
    "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.",
  );

const simplifiedSourceSummarySchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(1600),
    relevance: sourceRelevanceSchema,
  })
  .strict();

const sourceNumbers = z.array(z.number().int().positive()).min(1).max(40);
const blufNumbers = z.array(z.number().int().positive()).max(40);
const citedItem = z.object({ text: z.string().trim().min(1).max(1200), sourceNumbers }).strict();

export const structuredReportSchema = z
  .object({
    bluf: z.string().trim().min(1).max(2400),
    blufSourceNumbers: blufNumbers,
    keyFindings: z.array(citedItem).max(12),
    timeline: z
      .array(
        z
          .object({
            date: z.string().trim().min(1).max(60),
            event: z.string().trim().min(1).max(1000),
            sourceNumbers,
          })
          .strict(),
      )
      .max(20),
    perspectives: z
      .array(
        z
          .object({
            group: z.string().trim().min(1).max(100),
            summary: z.string().trim().min(1).max(1000),
            sourceNumbers,
          })
          .strict(),
      )
      .max(12),
    disagreements: z
      .array(
        z
          .object({
            topic: z.string().trim().min(1).max(400),
            positions: z
              .array(
                z
                  .object({
                    group: z.string().trim().min(1).max(100),
                    text: z.string().trim().min(1).max(800),
                    sourceNumbers,
                  })
                  .strict(),
              )
              .min(2)
              .max(8),
          })
          .strict(),
      )
      .max(8),
    entities: z
      .array(z.object({ name: z.string().trim().min(1).max(180), sourceNumbers }).strict())
      .max(30),
    gaps: z.array(citedItem).max(12),
    watch: z.array(citedItem).max(12),
    caveats: z.array(citedItem).max(12),
  })
  .strict()
  .describe(
    "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.",
  );

export type StructuredReport = z.infer<typeof structuredReportSchema>;

export const storedStructuredReportSchema = structuredReportSchema.extend({
  weakFindings: z
    .array(z.object({ text: z.string().trim().min(1).max(1200) }).strict())
    .max(12)
    .optional(),
});

export type StoredStructuredReport = z.infer<typeof storedStructuredReportSchema>;

export const simplifiedStructuredReportSchema = z
  .object({
    bluf: z.string().trim().min(1).max(2400),
    blufSourceNumbers: blufNumbers,
    keyFindings: z.array(citedItem).max(8),
  })
  .strict()
  .describe(
    "output language: Azerbaijani (az-Latn); do not copy source-language sentences; entity names and quote keep original script.",
  );

export function completeSimplifiedReport(
  report: z.infer<typeof simplifiedStructuredReportSchema>,
): StructuredReport {
  return {
    ...report,
    timeline: [],
    perspectives: [],
    disagreements: [],
    entities: [],
    gaps: [],
    watch: [],
    caveats: [],
  };
}

export function isStructuredReportAzerbaijani(report: StoredStructuredReport): boolean {
  return (
    looksAzerbaijani(report.bluf) &&
    (report.weakFindings ?? []).every((item) => looksAzerbaijani(item.text)) &&
    report.keyFindings.every((item) => looksAzerbaijani(item.text)) &&
    report.timeline.every((item) => looksAzerbaijani(item.event)) &&
    report.perspectives.every(
      (item) => looksAzerbaijani(item.group) && looksAzerbaijani(item.summary),
    ) &&
    report.disagreements.every(
      (item) =>
        looksAzerbaijani(item.topic) &&
        item.positions.every(
          (position) => looksAzerbaijani(position.group) && looksAzerbaijani(position.text),
        ),
    ) &&
    report.gaps.every((item) => looksAzerbaijani(item.text)) &&
    report.watch.every((item) => looksAzerbaijani(item.text)) &&
    report.caveats.every((item) => looksAzerbaijani(item.text))
  );
}

function extractJson(value: string): unknown {
  const unwrapped = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(unwrapped) as unknown;
}

function normalizedWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function quoteIsExact(quote: string | null, sourceText: string): boolean {
  if (!quote || quote.trim().split(/\s+/).length > 25) return false;
  return normalizedWhitespace(sourceText).includes(normalizedWhitespace(quote));
}

function explicitDateExists(value: string | null, sourceText: string): boolean {
  if (!value) return false;
  const normalized = normalizedWhitespace(value);
  return normalizedWhitespace(sourceText).includes(normalized);
}

export function parseSourceSummaries(
  response: string,
  sources: readonly {
    number: number;
    title: string;
    publishedAt?: Date;
    text: string;
  }[],
): SourceSummary[] {
  return parseSourceSummariesDetailed(response, sources).summaries;
}

export function parseSourceSummariesDetailed(
  response: string,
  sources: readonly {
    number: number;
    title: string;
    publishedAt?: Date;
    text: string;
  }[],
): ParsedSourceSummaries {
  const failures = new Map<number, SummaryOutputFailure>();
  let parsed: unknown;
  try {
    parsed = extractJson(response);
  } catch {
    for (const source of sources) failures.set(source.number, "invalid_json");
    return { summaries: [], failures };
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>)["sources"])
      ? (parsed as { sources: unknown[] }).sources
      : [];
  if (!rows.length) {
    for (const source of sources) failures.set(source.number, "schema");
    return { summaries: [], failures };
  }
  const byNumber = new Map(sources.map((source) => [source.number, source]));
  const output = new Map<number, SourceSummary>();
  const rowsByNumber = new Map<number, unknown[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const number = (row as Record<string, unknown>)["number"];
    if (typeof number === "number" && Number.isInteger(number)) {
      rowsByNumber.set(number, [...(rowsByNumber.get(number) ?? []), row]);
    }
  }
  const hasUnexpectedNumber = [...rowsByNumber.keys()].some((number) => !byNumber.has(number));
  for (const source of sources) {
    const matches = rowsByNumber.get(source.number) ?? [];
    if (matches.length !== 1) {
      failures.set(
        source.number,
        matches.length > 1 || hasUnexpectedNumber ? "source_number" : "missing",
      );
      continue;
    }
    const row = matches[0];
    const fullResult = sourceSummarySchema.safeParse(row);
    const simplifiedResult = simplifiedSourceSummarySchema.safeParse(row);
    const result: SourceSummary | null = fullResult.success
      ? fullResult.data
      : simplifiedResult.success
        ? {
            ...simplifiedResult.data,
            claims: [],
            entities: [],
            eventDate: null,
            publicationDate: null,
            quote: null,
          }
        : null;
    if (!result) {
      failures.set(source.number, "schema");
      continue;
    }
    if (!isAzerbaijaniSummaryContent(result.summary, result.claims)) {
      failures.set(source.number, "language");
      continue;
    }
    const eventDate = explicitDateExists(result.eventDate, source.text) ? result.eventDate : null;
    const quote = quoteIsExact(result.quote, source.text) ? result.quote : null;
    output.set(result.number, {
      ...result,
      eventDate,
      publicationDate: source.publishedAt?.toISOString().slice(0, 10) ?? null,
      quote,
    });
  }
  return { summaries: [...output.values()], failures };
}

function keepValidNumbers(value: unknown, allowed: Set<number>): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is number => typeof item === "number" && allowed.has(item)),
    ),
  ];
}

function sanitizeCitedItem(value: unknown, allowed: Set<number>): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const numbers = keepValidNumbers(row["sourceNumbers"], allowed);
  if (!numbers.length) return null;
  return { ...row, sourceNumbers: numbers };
}

export function parseStructuredReport(
  response: string,
  allowedNumbers: readonly number[],
): { report: StructuredReport; incomplete: boolean } {
  const parsed = extractJson(response);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid report JSON.");
  const row = parsed as Record<string, unknown>;
  const allowed = new Set(allowedNumbers);
  const blufSourceNumbers = keepValidNumbers(row["blufSourceNumbers"], allowed);
  const keyFindings = Array.isArray(row["keyFindings"])
    ? row["keyFindings"].map((item) => sanitizeCitedItem(item, allowed)).filter(Boolean)
    : [];
  const gaps = Array.isArray(row["gaps"])
    ? row["gaps"].map((item) => sanitizeCitedItem(item, allowed)).filter(Boolean)
    : [];
  const watch = Array.isArray(row["watch"])
    ? row["watch"].map((item) => sanitizeCitedItem(item, allowed)).filter(Boolean)
    : [];
  const caveats = Array.isArray(row["caveats"])
    ? row["caveats"].map((item) => sanitizeCitedItem(item, allowed)).filter(Boolean)
    : [];
  const timeline = Array.isArray(row["timeline"])
    ? row["timeline"].flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const itemRow = item as Record<string, unknown>;
        const numbers = keepValidNumbers(itemRow["sourceNumbers"], allowed);
        return numbers.length ? [{ ...itemRow, sourceNumbers: numbers }] : [];
      })
    : [];
  const perspectives = Array.isArray(row["perspectives"])
    ? row["perspectives"].flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const itemRow = item as Record<string, unknown>;
        const numbers = keepValidNumbers(itemRow["sourceNumbers"], allowed);
        return numbers.length ? [{ ...itemRow, sourceNumbers: numbers }] : [];
      })
    : [];
  const disagreements = Array.isArray(row["disagreements"])
    ? row["disagreements"].flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const itemRow = item as Record<string, unknown>;
        const positions = Array.isArray(itemRow["positions"])
          ? itemRow["positions"].flatMap((position) => {
              if (!position || typeof position !== "object" || Array.isArray(position)) return [];
              const positionRow = position as Record<string, unknown>;
              const numbers = keepValidNumbers(positionRow["sourceNumbers"], allowed);
              return numbers.length ? [{ ...positionRow, sourceNumbers: numbers }] : [];
            })
          : [];
        return positions.length >= 2 ? [{ ...itemRow, positions }] : [];
      })
    : [];
  const entities = Array.isArray(row["entities"])
    ? row["entities"].flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const itemRow = item as Record<string, unknown>;
        const numbers = keepValidNumbers(itemRow["sourceNumbers"], allowed);
        return numbers.length ? [{ ...itemRow, sourceNumbers: numbers }] : [];
      })
    : [];
  const result = structuredReportSchema.safeParse({
    ...row,
    blufSourceNumbers,
    keyFindings,
    timeline,
    perspectives,
    disagreements,
    entities,
    gaps,
    watch,
    caveats,
  });
  if (!result.success) throw new Error("Invalid structured report.");
  if (allowed.size && result.data.blufSourceNumbers.length === 0) {
    throw new Error("Structured report BLUF is missing source numbers.");
  }
  const hadBadNumbers =
    JSON.stringify(row["blufSourceNumbers"]) !== JSON.stringify(blufSourceNumbers) ||
    [
      "keyFindings",
      "timeline",
      "perspectives",
      "disagreements",
      "entities",
      "gaps",
      "watch",
      "caveats",
    ].some(
      (key) =>
        JSON.stringify(row[key]) !== JSON.stringify((result.data as Record<string, unknown>)[key]),
    );
  return { report: result.data, incomplete: hadBadNumbers };
}

export function keepExplicitTimelineDates<T extends StructuredReport>(
  report: T,
  sources: readonly { number: number; eventDate: string | null; publicationDate: string | null }[],
): T {
  const byNumber = new Map(sources.map((source) => [source.number, source]));
  return {
    ...report,
    timeline: report.timeline.map((item) => {
      const hasExplicitDate = item.sourceNumbers.some((number) => {
        const source = byNumber.get(number);
        return Boolean(source && [source.eventDate, source.publicationDate].includes(item.date));
      });
      return hasExplicitDate ? item : { ...item, date: az.osint.eventDateUnknown };
    }),
  };
}

export function reportSummaryText(report: StructuredReport): string {
  const citations = (numbers: number[]) => numbers.map((number) => "[" + number + "]").join(" ");
  return [
    report.bluf +
      (report.blufSourceNumbers.length ? " " + citations(report.blufSourceNumbers) : ""),
    ...report.keyFindings.map(
      (finding) => "- " + finding.text + " " + citations(finding.sourceNumbers),
    ),
  ].join("\n");
}
