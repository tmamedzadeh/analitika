import { z } from "zod";
import { az } from "@/lib/i18n/az";

export const sourceSummarySchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(1600),
    claims: z.array(z.string().trim().min(1).max(500)).max(3),
    entities: z.array(z.string().trim().min(1).max(160)).max(20),
    eventDate: z.string().trim().min(1).max(60).nullable(),
    publicationDate: z.string().trim().min(1).max(60).nullable(),
    quote: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export type SourceSummary = z.infer<typeof sourceSummarySchema>;

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
  .strict();

export type StructuredReport = z.infer<typeof structuredReportSchema>;

function extractJson(value: string): unknown {
  return JSON.parse(value.trim()) as unknown;
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
  const parsed = extractJson(response);
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>)["sources"])
      ? (parsed as { sources: unknown[] }).sources
      : [];
  const byNumber = new Map(sources.map((source) => [source.number, source]));
  const output = new Map<number, SourceSummary>();
  for (const row of rows) {
    const result = sourceSummarySchema.safeParse(row);
    if (!result.success) continue;
    const source = byNumber.get(result.data.number);
    if (!source) continue;
    const eventDate = explicitDateExists(result.data.eventDate, source.text)
      ? result.data.eventDate
      : null;
    const quote = quoteIsExact(result.data.quote, source.text) ? result.data.quote : null;
    output.set(result.data.number, {
      ...result.data,
      eventDate,
      publicationDate: source.publishedAt?.toISOString().slice(0, 10) ?? null,
      quote,
    });
  }
  return [...output.values()];
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

export function keepExplicitTimelineDates(
  report: StructuredReport,
  sources: readonly { number: number; eventDate: string | null; publicationDate: string | null }[],
): StructuredReport {
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

export function fallbackStructuredReport(
  sources: readonly {
    number: number;
    title: string;
    summary: string;
    claims: string[];
    eventDate?: string | null;
  }[],
): StructuredReport {
  const first = sources[0];
  const sourceNumbers = sources.map((source) => source.number);
  return {
    bluf: first ? first.summary : az.osint.noSources,
    blufSourceNumbers: first ? [first.number] : [],
    keyFindings: sources
      .flatMap((source) =>
        source.claims.slice(0, 1).map((text) => ({ text, sourceNumbers: [source.number] })),
      )
      .slice(0, 8),
    timeline: sources
      .flatMap((source) =>
        source.eventDate
          ? [{ date: source.eventDate, event: source.summary, sourceNumbers: [source.number] }]
          : [],
      )
      .slice(0, 12),
    perspectives: [],
    disagreements: [],
    entities: [],
    gaps: [],
    watch: [],
    caveats: sourceNumbers.length
      ? [
          {
            text: az.osint.finalFallback,
            sourceNumbers: [sourceNumbers[0]!],
          },
        ]
      : [],
  };
}
