import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { az } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getBakuDate } from "@/lib/briefs";
import {
  periodLabels,
  periodValues,
  resolvePeriod,
  type PeriodFilter as Value,
} from "@/lib/period";

const calendarDate = (value: string) => new Date(`${value}T12:00:00`);
const dateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Draft dates live only here. Closing/cancelling never changes the query. */
export function PeriodFilter({
  value,
  onChange,
  legacyLabel,
  variant = "analytics",
}: {
  value: Value;
  onChange: (value: Value) => void;
  legacyLabel?: string | undefined;
  variant?: "analytics" | "catalog";
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>();
  const today = calendarDate(getBakuDate());
  function begin() {
    setRange(
      value.period === "custom" && value.from
        ? { from: calendarDate(value.from), to: value.to ? calendarDate(value.to) : undefined }
        : undefined,
    );
    setOpen(true);
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        aria-label="Dövr"
        className="field filter-control w-auto! min-w-36"
        value={open ? "custom" : legacyLabel ? "legacy" : value.period}
        onChange={(event) => {
          const period = event.target.value as Value["period"];
          if (period === "custom") begin();
          else {
            setOpen(false);
            onChange({ period });
          }
        }}
      >
        {legacyLabel && (
          <option value="legacy" disabled>
            Əvvəlki: {legacyLabel} · Dövr seçin
          </option>
        )}
        {variant === "catalog" && value.period !== "all" && value.period !== "custom" && (
          <option value={value.period} disabled>
            {periodLabels[value.period]} · Əvvəlki seçim
          </option>
        )}
        {(variant === "catalog" ? (["all", "custom"] as const) : periodValues).map((period) => (
          <option key={period} value={period}>
            {period === "all" && variant === "catalog" ? "Bütün dövr" : periodLabels[period]}
          </option>
        ))}
      </select>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) begin();
          else setOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={value.period === "custom" ? "filter-control text-xs" : "sr-only"}
            tabIndex={value.period === "custom" ? 0 : -1}
            aria-label="Xüsusi dövrü seçin"
          >
            {value.from && value.to ? `${value.from} – ${value.to}` : "Tarixləri seçin"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] overflow-auto p-0">
          <Calendar
            mode="range"
            locale={az}
            captionLayout="dropdown"
            startMonth={new Date(1900, 0)}
            endMonth={today}
            defaultMonth={range?.from ?? today}
            today={today}
            selected={range}
            disabled={{ after: today }}
            labels={{
              labelPrevious: () => "Əvvəlki ay",
              labelNext: () => "Növbəti ay",
              labelMonthDropdown: () => "Ay",
              labelYearDropdown: () => "İl",
            }}
            onDayClick={(day, modifiers) => {
              if (modifiers["disabled"]) return;
              setRange((current) =>
                !current?.from || current.to
                  ? { from: day, to: undefined }
                  : day < current.from
                    ? { from: day, to: current.from }
                    : { from: current.from, to: day },
              );
            }}
          />
          <div aria-live="polite" className="px-3 pb-2 text-xs text-muted-foreground">
            {range?.from
              ? `${dateValue(range.from)} – ${dateValue(range.to ?? range.from)}`
              : "Başlanğıc və son tarixi seçin"}
          </div>
          <div className="flex justify-end gap-2 border-t p-3">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Ləğv et
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!range?.from}
              onClick={() => {
                if (!range?.from) return;
                const next: Value = {
                  period: "custom",
                  from: dateValue(range.from),
                  to: dateValue(range.to ?? range.from),
                };
                resolvePeriod(next);
                onChange(next);
                setOpen(false);
              }}
            >
              Tətbiq et
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
