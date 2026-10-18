import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, Plus, Search } from "lucide-react";
import { useState } from "react";

import { BriefCard } from "@/components/BriefCard";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { listBriefs } from "@/lib/briefs.functions";
import { getBakuDate, briefHead } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/")({
  head: () => briefHead(az.briefs.title, az.briefs.description),
  component: DailyBriefs,
});

function DailyBriefs() {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const [month, setMonth] = useState("");
  const today = getBakuDate();
  const briefsQuery = useInfiniteQuery({
    queryKey: ["daily-briefs", query, period, month],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listBriefs({ data: { query, period, month, cursor: pageParam } }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const briefs = briefsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const todayBrief = briefs.find((brief) => brief.date === today);
  const orderedBriefs = todayBrief
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
        <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground sm:ml-auto">
          <CalendarDays size={16} aria-hidden="true" />
          <span>{az.briefs.month}</span>
          <input
            className="field !w-40"
            type="month"
            aria-label={az.briefs.chooseMonth}
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setPeriod("all");
            }}
          />
        </label>
      </div>

      {briefsQuery.isLoading && (
        <p role="status" className="py-12 text-center text-muted-foreground">
          {az.briefs.loading}
        </p>
      )}
      {briefsQuery.isError && (
        <p role="alert" className="py-8 text-center text-destructive">
          {az.briefs.listFailed}
        </p>
      )}
      {todayBrief && !briefsQuery.isLoading && (
        <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-primary">
          {az.briefs.today}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {orderedBriefs.map((brief, index) => (
          <div key={brief.id} className={index === 0 ? "sm:col-span-2 xl:col-span-3" : ""}>
            <BriefCard brief={brief} featured={index === 0} />
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
            {briefsQuery.isFetchingNextPage ? az.briefs.loading : az.briefs.loadMore}
          </Button>
        </div>
      )}
    </Shell>
  );
}
