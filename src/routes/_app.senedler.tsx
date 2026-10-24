import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Paperclip, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PeriodFilter } from "@/components/PeriodFilter";
import { ReliabilityFilters, type ReliabilitySelection } from "@/components/ReliabilityFilters";
import { FilterBar } from "@/components/FilterBar";
import {
  filterRouteSearchSchema,
  parsePeriodSearch,
  parseRatingsSearch,
  parseDirectionSearch,
  useFilterSearchState,
} from "@/lib/filter-search-state";
import { Shell } from "@/components/Shell";
import { ZirveSkeleton, ZirveActionLabel, ZirveQueryIndicator } from "@/components/ZirveLoader";
import { Button } from "@/components/ui/button";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { listDocuments, retryDocumentIndexing } from "@/lib/documents.functions";
import { directions, directionLabel, type DirectionId } from "@/lib/directions";
import { az } from "@/lib/i18n/az";

type DocumentCursor = { createdAt: string; id: string; score?: number | undefined };

export const Route = createFileRoute("/_app/senedler")({
  validateSearch: filterRouteSearchSchema,
  head: () => ({
    meta: [
      { title: `${az.navigation.documents} · Analitika` },
      { name: "description", content: az.documentLibrary.description },
    ],
  }),
  component: DocumentLibrary,
});

export function DocumentLibrary() {
  const queryClient = useQueryClient();
  const [draftQuery, setDraftQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [direction, setDirection] = useFilterSearchState("direction", parseDirectionSearch);
  const [period, setPeriod] = useFilterSearchState("period", parsePeriodSearch);
  const [ratings, setRatings] = useFilterSearchState("ratings", parseRatingsSearch);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const documents = useInfiniteQuery({
    queryKey: ["documents", "catalog", submittedQuery, direction, period, ratings],
    initialPageParam: null as DocumentCursor | null,
    queryFn: ({ pageParam, signal }) =>
      listDocuments({
        data: {
          query: submittedQuery,
          direction: direction || undefined,
          ...period,
          ...ratings,
          cursor: pageParam,
        },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some((item) => item.status === "queued" || item.status === "processing"),
      )
        ? 3000
        : false,
  });
  const items = documents.data?.pages.flatMap((page) => page.items) ?? [];

  async function retry(documentId: string) {
    setRetryingId(documentId);
    try {
      const result = await retryDocumentIndexing({ data: { documentId } });
      toast.success(
        result.queueFailed ? az.documents.form.savedQueuePending : az.documents.form.success,
      );
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : az.documents.loadError);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Shell
      crumb={az.navigation.documents}
      title={az.navigation.documents}
      actions={
        <Button asChild size="lg" className="glow">
          <Link to="/senedler/yeni">
            <Plus />
            {az.documentLibrary.add}
          </Link>
        </Button>
      }
    >
      {/* The query indicator reserves 32px below this 8px margin: 40px to cards. */}
      <div className="panel mb-2 flex flex-col gap-3 p-4">
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
              aria-label={az.documentLibrary.search}
              placeholder={az.documentLibrary.searchPlaceholder}
              maxLength={200}
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </label>
          <Button type="submit">{az.actions.search}</Button>
        </form>
        <FilterBar>
          <PeriodFilter variant="catalog" value={period} onChange={setPeriod} />
          <select
            className="field filter-control w-auto! max-w-full sm:max-w-56"
            aria-label={az.directions.field}
            value={direction}
            onChange={(event) => setDirection(event.target.value as DirectionId | "")}
          >
            <option value="">{az.directions.all}</option>
            {directions.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <ReliabilityFilters value={ratings} onChange={setRatings} />
          {(ratings.sourceReliabilities.length > 0 ||
            ratings.infoCredibilities.length > 0 ||
            direction) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRatings({ sourceReliabilities: [], infoCredibilities: [] });
                setDirection("");
              }}
            >
              Əlavə filtrləri təmizlə
            </Button>
          )}
        </FilterBar>
      </div>
      <ZirveQueryIndicator
        fetching={!documents.isPending && documents.isFetching && !documents.isFetchingNextPage}
      />
      {documents.isError && (
        <div role="alert" className="panel p-6 text-sm text-destructive">
          {az.documents.loadError}{" "}
          <Button variant="ghost" onClick={() => void documents.refetch()}>
            {az.actions.retry}
          </Button>
        </div>
      )}
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-busy={documents.isPending}
      >
        {documents.isPending &&
          Array.from({ length: 6 }, (_, index) => (
            <ZirveSkeleton key={index} label={az.documents.loading} rows={5} className="min-h-48" />
          ))}
        {items.map((document) => (
          <article
            key={document.id}
            className="panel relative flex min-w-0 flex-col gap-3 p-5 transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-primary"
          >
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <time dateTime={document.docDate ?? document.createdAt}>
                {!document.docDate && <span>Əlavə edilib: </span>}
                {new Date(
                  document.docDate ? `${document.docDate}T12:00:00Z` : document.createdAt,
                ).toLocaleDateString("az-AZ", { timeZone: "Asia/Baku" })}
              </time>
              {document.hasAttachments && (
                <span title={az.documentLibrary.attachments}>
                  <Paperclip size={14} aria-label={az.documentLibrary.attachments} />
                </span>
              )}
            </div>
            <h2 className="font-semibold [overflow-wrap:anywhere]">
              <Link
                to="/senedler/$id"
                params={{ id: document.id }}
                className="after:absolute after:inset-0 after:rounded-xl"
              >
                {document.title}
              </Link>
            </h2>
            <p className="line-clamp-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {document.preview}
            </p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Mətnin indekslənməsi:{" "}
                {
                  {
                    queued: "Növbədə",
                    processing: "Emal olunur",
                    ready: "Hazırdır",
                    failed: "Xəta",
                  }[document.status]
                }
              </p>
              {document.imageStatus && <p>Şəkillər: {document.imageStatus}</p>}
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
              <span>{directionLabel(document.direction) ?? az.directions.unassigned}</span>
              <ClassificationBadge classification={document.classification} />
              {document.status !== "ready" && (
                <span
                  className={document.status === "failed" ? "text-destructive" : "text-warning"}
                >
                  {az.documents.status[document.status]}
                </span>
              )}
            </div>
            {document.status === "failed" && document.canManage && (
              <Button
                variant="outline"
                className="relative z-10 self-start rounded-full"
                disabled={retryingId === document.id}
                aria-busy={retryingId === document.id}
                onClick={() => void retry(document.id)}
              >
                <ZirveActionLabel
                  busy={retryingId === document.id}
                  label={az.documents.retry}
                  pendingLabel={az.documents.retrying}
                />
              </Button>
            )}
          </article>
        ))}
      </div>
      {!documents.isPending && !documents.isError && items.length === 0 && (
        <div className="panel p-12 text-center text-sm text-muted-foreground">
          {submittedQuery || direction ? az.documentLibrary.noMatches : az.documents.empty}
        </div>
      )}
      {documents.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={documents.isFetchingNextPage}
            aria-busy={documents.isFetchingNextPage}
            onClick={() => void documents.fetchNextPage()}
          >
            <ZirveActionLabel
              busy={documents.isFetchingNextPage}
              label={az.documentLibrary.loadMore}
              pendingLabel={az.documents.loading}
            />
          </Button>
        </div>
      )}
    </Shell>
  );
}
