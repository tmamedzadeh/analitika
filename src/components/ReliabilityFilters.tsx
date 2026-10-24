import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sourceReliabilityValues, infoCredibilityValues } from "@/lib/reliability";
import { az } from "@/lib/i18n/az";

export type ReliabilitySelection = {
  sourceReliabilities: (typeof sourceReliabilityValues)[number][];
  infoCredibilities: (typeof infoCredibilityValues)[number][];
};
function RatingMultiSelect<T extends string | number>({
  label,
  values,
  selected,
  onChange,
  description,
}: {
  label: string;
  values: readonly T[];
  selected: readonly T[];
  onChange: (value: T[]) => void;
  description: (value: T) => string;
}) {
  const id = useId();
  const summary = selected.length > 3 ? `${selected.length} seçilib` : selected.join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="filter-control max-w-full gap-2 font-normal"
          aria-label={`${label}: ${summary || "Hamısı"}`}
        >
          <span className="truncate">
            {label}
            {summary ? ` · ${summary}` : ""}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)] p-2">
        <fieldset>
          <legend id={id} className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {label}
          </legend>
          {values.map((value) => (
            <label
              key={value}
              className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent focus-within:ring-2 focus-within:ring-ring"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.includes(value)}
                onChange={() =>
                  onChange(
                    selected.includes(value)
                      ? selected.filter((item) => item !== value)
                      : values.filter((item) => selected.includes(item) || item === value),
                  )
                }
              />
              <span>
                <strong>{value}</strong> · {description(value)}
              </span>
            </label>
          ))}
        </fieldset>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          disabled={!selected.length}
          onClick={() => onChange([])}
        >
          Seçimi təmizlə
        </Button>
      </PopoverContent>
    </Popover>
  );
}
export function ReliabilityFilters({
  value,
  onChange,
}: {
  value: ReliabilitySelection;
  onChange: (value: ReliabilitySelection) => void;
}) {
  return (
    <>
      <RatingMultiSelect
        label="Mənbə etibarlılığı"
        values={sourceReliabilityValues}
        selected={value.sourceReliabilities}
        onChange={(sourceReliabilities) => onChange({ ...value, sourceReliabilities })}
        description={(v) => az.reliability.source[v as keyof typeof az.reliability.source]}
      />
      <RatingMultiSelect
        label="Məlumat etibarlılığı"
        values={infoCredibilityValues}
        selected={value.infoCredibilities}
        onChange={(infoCredibilities) => onChange({ ...value, infoCredibilities })}
        description={(v) =>
          az.reliability.information[v as keyof typeof az.reliability.information]
        }
      />
    </>
  );
}
