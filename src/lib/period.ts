import { z } from "zod";
import { getBakuDate } from "./briefs";

export const periodValues = ["30d", "90d", "12m", "custom", "all"] as const;
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Tarix düzgün deyil.");
export const periodShape = {
  period: z.enum(periodValues).default("30d"),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
};
export type PeriodFilter = {
  period: (typeof periodValues)[number];
  from?: string | undefined;
  to?: string | undefined;
};
export const defaultPeriod: PeriodFilter = { period: "30d" };
export const defaultCatalogPeriod: PeriodFilter = { period: "all" };
export const periodLabels = {
  "30d": "Son ay",
  "90d": "Son rüb",
  "12m": "Son il",
  custom: "Xüsusi dövr",
  all: "Hamısı",
};
export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const bakuClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Baku",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  era: "short",
});
/** Historical custom ranges also honor Baku DST (before its abolition in 2016). */
export function bakuMidnight(value: string): Date {
  const target = Date.parse(`${value}T00:00:00Z`);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(
      bakuClock.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const year = parts["era"] === "BC" ? 1 - Number(parts["year"]) : Number(parts["year"]);
    const wall = Date.parse(
      `${String(year).padStart(4, "0")}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}Z`,
    );
    const next = target - (wall - instant);
    if (next === instant) return new Date(instant);
    instant = next;
  }
  return new Date(instant);
}
/** Inclusive Baku dates: 30/90 days count today; 12 months starts the day after
 * the clamped anniversary (leap day -> Feb 28). Timestamps use [start,end).
 * Presets ignore stale custom fields. No unbounded new requests.
 */
type PeriodWindow = { from: string; through: string; start: Date; endExclusive: Date };
export function resolvePeriod(
  input: Omit<PeriodFilter, "period"> & { period: Exclude<PeriodFilter["period"], "all"> },
  now?: Date,
): PeriodWindow;
export function resolvePeriod(input: PeriodFilter, now?: Date): PeriodWindow | null;
export function resolvePeriod(input: PeriodFilter, now = new Date()): PeriodWindow | null {
  const parsed = z.object(periodShape).parse(input);
  if (parsed.period === "all") return null;
  const today = getBakuDate(now);
  let from: string;
  let through = today;
  if (parsed.period === "custom") {
    if (!parsed.from || !parsed.to || parsed.from > parsed.to || parsed.to > today)
      throw new Error("Tarix intervalını yoxlayın: başlanğıc ≤ son ≤ bu gün.");
    from = parsed.from;
    through = parsed.to;
  } else if (parsed.period === "12m") {
    const [year, month, day] = today.split("-").map(Number) as [number, number, number];
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    const anniversary = `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
    from = addDays(anniversary, 1);
  } else from = addDays(today, -(parsed.period === "30d" ? 29 : 89));
  return {
    from,
    through,
    start: bakuMidnight(from),
    endExclusive: bakuMidnight(addDays(through, 1)),
  };
}
