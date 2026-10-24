import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { BriefCard } from "@/components/BriefCard";
import { Shell } from "@/components/Shell";
import { ZirveSkeleton, ZirveActionLabel, ZirveQueryIndicator } from "@/components/ZirveLoader";
import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/components/PeriodFilter";
import { FilterBar } from "@/components/FilterBar";
import {
  filterRouteSearchSchema,
  parsePeriodSearch,
  useFilterSearchState,
} from "@/lib/filter-search-state";
import { listBriefs } from "@/lib/briefs.functions";
import { getBakuDate, briefHead, type BriefCursor } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/_app/")({
  validateSearch: filterRouteSearchSchema,
  head: () => briefHead(az.briefs.title, az.briefs.description),
  component: DailyBriefs,
});

export function DailyBriefs() {
  const [draftQuery, setDraftQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [period, setPeriod] = useFilterSearchState("period", parsePeriodSearch);
  const today = getBakuDate();
  const briefsQuery = useInfiniteQuery({
    queryKey: ["daily-briefs", submittedQuery, period],
    staleTime: 60_000,
    retry: false,
    initialPageParam: null as BriefCursor | null,
    queryFn: ({ pageParam, signal }) =>
      listBriefs({ data: { query: submittedQuery, ...period, cursor: pageParam }, signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const briefs = briefsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const todayBrief = briefs.find((brief) => brief.date === today);
  const orderedBriefs =
    todayBrief && !submittedQuery.trim()
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
      {/* The query indicator reserves 32px below this 8px margin: 40px to cards. */}
      <div className="panel mb-2 flex flex-col gap-3 p-4 md:flex-row md:items-start">
        <form
          role="search"
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedQuery(draftQuery.trim());
          }}
        >
          <label className="relative min-w-0 flex-1">
            <Search
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className="field pl-10"
              aria-label={az.briefs.searchLabel}
              placeholder="Bülletenlərdə axtarın"
              maxLength={200}
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary">
            {az.actions.search}
          </Button>
        </form>
        <div className="shrink-0">
          <PeriodFilter variant="catalog" value={period} onChange={setPeriod} />
        </div>
      </div>

      <ZirveQueryIndicator
        fetching={
          !briefsQuery.isPending && briefsQuery.isFetching && !briefsQuery.isFetchingNextPage
        }
      />
      {briefsQuery.isError && (
        <p role="alert" className="py-8 text-center text-destructive">
          {az.briefs.listFailed}
          <button
            type="button"
            className="min-h-11 px-3 underline"
            onClick={() => void briefsQuery.refetch()}
          >
            {az.actions.retry}
          </button>
        </p>
      )}
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-busy={briefsQuery.isPending}
      >
        {briefsQuery.isPending &&
          Array.from({ length: 6 }, (_, index) => (
            <ZirveSkeleton key={index} label={az.briefs.loading} rows={5} className="min-h-48" />
          ))}
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
          <p className="max-w-md text-sm leading-6 text-muted-foreground">{az.briefs.noMatches}</p>
        </div>
      )}
      {briefsQuery.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={briefsQuery.isFetchingNextPage}
            aria-busy={briefsQuery.isFetchingNextPage}
            onClick={() => void briefsQuery.fetchNextPage()}
          >
            <ZirveActionLabel
              busy={briefsQuery.isFetchingNextPage}
              label={az.briefs.loadMore}
              pendingLabel={az.briefs.loading}
            />
          </Button>
        </div>
      )}
    </Shell>
  );
}
