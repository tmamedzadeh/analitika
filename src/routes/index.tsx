import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
      badges={[az.analytics.systemReady]}
      actions={
        <Button asChild size="lg" className="glow">
          <Link to="/brifler/yeni">
            <Plus />
            {az.briefs.add}
          </Link>
        </Button>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          className="field sm:!w-72"
          aria-label={az.briefs.searchLabel}
          placeholder={az.briefs.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
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
              className={`rounded-full ${period === value ? "border border-primary/40 text-primary" : ""}`}
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {az.briefs.month}:
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
        <p className="label-mono mb-2 !text-primary !tracking-normal">{az.briefs.today}</p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        {orderedBriefs.map((brief, index) => (
          <div
            key={brief.id}
            className={
              index === 0 ? "lg:col-span-6" : index < 4 ? "lg:col-span-2" : "lg:col-span-3"
            }
          >
            <BriefCard brief={brief} featured={index === 0} />
          </div>
        ))}
      </div>
      {!briefsQuery.isLoading && !briefsQuery.isError && briefs.length === 0 && (
        <div className="panel flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-muted-foreground">
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
