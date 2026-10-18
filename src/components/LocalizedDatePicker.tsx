import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { az as azCalendarLocale } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const shortMonthsAz = [
  "Yan",
  "Fev",
  "Mar",
  "Apr",
  "May",
  "İyn",
  "İyl",
  "Avq",
  "Sen",
  "Okt",
  "Noy",
  "Dek",
];

function parseDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;

  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

function formatDateValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

type LocalizedDatePickerProps = {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  clearable?: boolean;
  clearLabel?: string;
};

export function LocalizedDatePicker({
  name,
  value,
  onChange,
  placeholder,
  required = false,
  clearable = false,
  clearLabel,
}: LocalizedDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseDate(value);
  const dateLabel = selectedDate
    ? `${selectedDate.getDate()} ${shortMonthsAz[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
    : placeholder;

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="field justify-start px-3 text-left font-normal"
            aria-label={dateLabel}
            aria-required={required || undefined}
          >
            <CalendarDays aria-hidden="true" />
            {dateLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={azCalendarLocale}
            selected={selectedDate}
            defaultMonth={selectedDate ?? new Date()}
            onSelect={(date) => {
              if (!date) return;
              onChange(formatDateValue(date));
              setOpen(false);
            }}
          />
          {clearable && value && clearLabel && (
            <div className="border-t border-border p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {clearLabel}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
