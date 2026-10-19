import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { directions, directionIds, type DirectionId } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import { cn } from "@/lib/utils";

function directionSummary(selected: readonly DirectionId[]): string {
  if (selected.length === 0) return az.directions.placeholder;
  if (selected.length === directionIds.length) return az.directions.all;
  if (selected.length === 1) {
    return directions.find(({ id }) => id === selected[0])?.label ?? az.directions.placeholder;
  }
  return az.directions.selectedCount.replace("{count}", String(selected.length));
}

type Props = {
  value: readonly DirectionId[];
  onChange: (next: DirectionId[]) => void;
};

export function DirectionMultiSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  function toggle(id: DirectionId) {
    onChange(value.includes(id) ? value.filter((current) => current !== id) : [...value, id]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span id="direction-filter-label">{az.directions.field}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby="direction-filter-label direction-filter-value"
            className="field flex items-center justify-between gap-2 text-left"
          >
            <span
              id="direction-filter-value"
              className={cn("truncate", value.length === 0 && "text-muted-foreground")}
            >
              {directionSummary(value)}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          // Radix measures the free space on the chosen side (after flipping) and exposes it as a
          // CSS variable, so the panel never exceeds the visible area and re-measures on
          // resize, zoom, fullscreen changes and scroll.
          className="flex max-h-[min(var(--radix-popover-content-available-height),22rem)] w-(--radix-popover-trigger-width) min-w-56 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
        >
          <Command className="h-auto min-h-0 flex-1">
            <CommandInput placeholder={az.directions.search} aria-label={az.directions.search} />
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5">
              <button
                type="button"
                className="rounded-sm px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange([...directionIds])}
              >
                {az.directions.selectAll}
              </button>
              <button
                type="button"
                className="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange([])}
              >
                {az.directions.clear}
              </button>
            </div>
            <CommandList
              label={az.directions.field}
              aria-multiselectable="true"
              className="max-h-none min-h-0 flex-1"
            >
              <CommandEmpty>{az.directions.noResults}</CommandEmpty>
              <CommandGroup>
                {directions.map(({ id, label }) => {
                  const checked = value.includes(id);
                  return (
                    <CommandItem
                      key={id}
                      value={label}
                      keywords={[id]}
                      onSelect={() => toggle(id)}
                      className="min-h-9"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-4 shrink-0 place-content-center rounded-sm border border-primary",
                          checked && "bg-primary text-primary-foreground",
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      {label}
                      {checked && <span className="sr-only">{az.directions.selectedState}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
