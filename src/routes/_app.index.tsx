import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BriefCard } from "@/components/BriefCard";
import { Shell } from "@/components/Shell";
import { ZirveLoader } from "@/components/ZirveLoader";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listBriefs } from "@/lib/briefs.functions";
import { getBakuDate, briefHead, type BriefCursor } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";
import { createFallbackNotifier } from "@/lib/ai-notifications";
import { Switch } from "@/components/ui/switch";

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

export const Route = createFileRoute("/_app/")({
  head: () => briefHead(az.briefs.title, az.briefs.description),
  component: DailyBriefs,
});

function DailyBriefs() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const [month, setMonth] = useState("");
  const [llm, setLlm] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const today = getBakuDate();
  const todayYear = Number(today.slice(0, 4));
  const [monthPickerYear, setMonthPickerYear] = useState(todayYear);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const selectedMonthIndex = month ? Number(month.slice(5, 7)) - 1 : -1;
  const selectedMonthYear = month ? Number(month.slice(0, 4)) : undefined;
  const briefsQuery = useInfiniteQuery({
    queryKey: ["daily-briefs", debouncedQuery, period, month, llm],
    staleTime: 60_000,
    retry: false,
    initialPageParam: null as BriefCursor | null,
    queryFn: ({ pageParam, signal }) =>
      listBriefs({ data: { query: debouncedQuery, period, month, llm, cursor: pageParam }, signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const notifyFallback = useMemo(() => createFallbackNotifier(), [debouncedQuery, period, month, llm]);
  useEffect(() => {
    briefsQuery.data?.pages.forEach((page) => page.fallbacks?.forEach(notifyFallback));
  }, [briefsQuery.data, notifyFallback]);
  const briefs = briefsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const todayBrief = briefs.find((brief) => brief.date === today);
  const orderedBriefs = todayBrief && !(llm && debouncedQuery)
    ? [todayBrief, ...briefs.filter((brief) => brief.id !== todayBrief.id)]
    : briefs;

  return (
    <Shell
      crumb={az.briefs.title}
      title={az.briefs.title}
      actions={
        <Button asChild size="lg" className="glow">
          <Link to="/brifler/yeni">
            <Plus />
            {az.briefs.add}
          </Link>
        </Button>
      }
    >
      <div className="panel mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative min-w-0 flex-1 sm:min-w-64">
          <Search
            size={17}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className="field pl-10"
            aria-label={az.briefs.searchLabel}
            placeholder={az.briefs.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium" title={az.ai.semanticSearch}>
          <Switch checked={llm} onCheckedChange={(checked) => { setDebouncedQuery(query); setLlm(checked); }} aria-label={az.ai.semanticSearch} />
          {az.ai.llm}
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={az.briefs.periodFilters}>
          {(
            [
              ["all", az.briefs.all],
              ["week", az.briefs.thisWeek],
              ["month", az.briefs.thisMonth],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={period === value ? "secondary" : "outline"}
              className={`rounded-full ${period === value ? "border border-primary/20 bg-accent text-primary" : ""}`}
              aria-pressed={period === value}
              onClick={() => {
                setPeriod(value);
                setMonth("");
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground sm:ml-auto">
          <CalendarDays size={16} aria-hidden="true" />
          <span>{az.briefs.month}</span>
          <Popover
            open={monthPickerOpen}
            onOpenChange={(open) => {
              setMonthPickerOpen(open);
              if (open) setMonthPickerYear(selectedMonthYear ?? todayYear);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="field w-40! justify-start px-3 font-normal"
                aria-label={
                  selectedMonthIndex >= 0
                    ? `${shortMonthsAz[selectedMonthIndex]} ${selectedMonthYear}`
                    : az.briefs.chooseMonth
                }
              >
                {selectedMonthIndex >= 0
                  ? `${shortMonthsAz[selectedMonthIndex]} ${selectedMonthYear}`
                  : az.briefs.chooseMonth}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="mb-3 flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={az.briefs.previousYear}
                  onClick={() => setMonthPickerYear((year) => year - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="text-sm font-semibold">{monthPickerYear}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={az.briefs.nextYear}
                  onClick={() => setMonthPickerYear((year) => year + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {shortMonthsAz.map((monthName, index) => {
                  const isSelected =
                    selectedMonthYear === monthPickerYear && selectedMonthIndex === index;
                  return (
                    <Button
                      key={monthName}
                      type="button"
                      variant={isSelected ? "secondary" : "ghost"}
                      className="h-10 px-2"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setMonth(`${monthPickerYear}-${String(index + 1).padStart(2, "0")}`);
                        setPeriod("all");
                        setMonthPickerOpen(false);
                      }}
                    >
                      {monthName}
                    </Button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {briefsQuery.isFetching && !briefsQuery.isFetchingNextPage && <ZirveLoader variant="compact" label={az.briefs.loading} />}
      {briefsQuery.data?.pages.some((page) => page.lexicalFallback) && <p role="status" className="mb-4 text-sm text-muted-foreground">{az.ai.lexicalFallback}</p>}
      {briefsQuery.isError && (
        <p role="alert" className="py-8 text-center text-destructive">
          {az.briefs.listFailed}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {orderedBriefs.map((brief) => (
          <div key={brief.id}>
            <BriefCard brief={brief} />
          </div>
        ))}
      </div>
      {!briefsQuery.isLoading && !briefsQuery.isError && briefs.length === 0 && (
        <div className="panel flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-accent text-primary">
            <Search size={20} aria-hidden="true" />
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {query || period !== "all" || month ? az.briefs.noMatches : az.briefs.empty}
          </p>
          {!query && period === "all" && !month && (
            <Button asChild className="glow">
              <Link to="/brifler/yeni">
                <Plus />
                {az.briefs.add}
              </Link>
            </Button>
          )}
        </div>
      )}
      {briefsQuery.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={briefsQuery.isFetchingNextPage}
            onClick={() => void briefsQuery.fetchNextPage()}
          >
            {briefsQuery.isFetchingNextPage && <ZirveLoader variant="inline" label="" />}
            {briefsQuery.isFetchingNextPage ? az.briefs.loading : az.briefs.loadMore}
          </Button>
        </div>
      )}
    </Shell>
  );
}
