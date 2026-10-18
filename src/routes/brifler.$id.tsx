import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { z } from "zod";

import { BriefMarkdown } from "@/components/BriefMarkdown";
import { Shell } from "@/components/Shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { deleteBrief, getBrief } from "@/lib/briefs.functions";
import { briefDate, briefHead } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/brifler/$id")({
  validateSearch: z.object({ chunk: z.string().uuid().optional() }),
  loaderDeps: ({ search }) => ({ chunk: search.chunk }),
  loader: ({ params, deps }) =>
    getBrief({
      data: { briefId: params.id, ...(deps.chunk ? { chunkId: deps.chunk } : {}) },
    }),
  head: () => briefHead(az.briefs.openTitle, az.briefs.description),
  component: BriefDetail,
});

function BriefDetail() {
  const initialData = Route.useLoaderData();
  const params = Route.useParams();
  const search = Route.useSearch();
  const briefQuery = useQuery({
    queryKey: ["daily-brief", params.id, search.chunk ?? ""],
    queryFn: () =>
      getBrief({
        data: { briefId: params.id, ...(search.chunk ? { chunkId: search.chunk } : {}) },
      }),
    initialData,
    refetchInterval: (query) => {
      const status = query.state.data?.brief.indexStatus;
      return status === "queued" || status === "processing" ? 2_000 : false;
    },
  });
  const data = briefQuery.data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const brief = data?.brief;
  const photo = photoIndex === null ? undefined : brief?.photos[photoIndex];

  if (!brief || !data) {
    return (
      <Shell crumb={az.briefs.title} title={az.briefs.missing} badges={[]}>
        <Button asChild variant="outline">
          <Link to="/">{az.briefs.backToList}</Link>
        </Button>
      </Shell>
    );
  }

  const briefId = brief.id;
  const date = briefDate(brief.date);
  async function confirmDelete() {
    setDeleting(true);
    setError("");
    try {
      await deleteBrief({ data: { briefId } });
      await queryClient.invalidateQueries({ queryKey: ["daily-briefs"] });
      await navigate({ to: "/" });
    } catch {
      setError(az.briefs.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Shell
      crumb={az.briefs.title}
      title={brief.title}
      badges={[]}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/brifler/$id/redakte" params={{ id: brief.id }}>
              {az.briefs.edit}
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="rounded-full" disabled={deleting}>
                <Trash2 />
                {az.briefs.delete}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{az.briefs.delete}</AlertDialogTitle>
                <AlertDialogDescription>{az.briefs.deleteConfirm}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{az.briefs.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    void confirmDelete();
                  }}
                >
                  {az.briefs.delete}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/">{az.briefs.backToList}</Link>
        </Button>
        <p className="label-mono !tracking-normal">
          {date.day} {date.month} · {date.weekday}
        </p>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div>
          <article className="rounded-xl border border-border bg-card p-5 text-sm leading-7 sm:p-6">
            <h2 className="sr-only">{az.briefs.markdown}</h2>
            <BriefMarkdown markdown={brief.body} highlight={brief.highlight} />
          </article>
          {brief.photos.length > 0 && (
            <section className="mt-5">
              <p className="label-mono mb-3 !tracking-normal">{az.briefs.photos}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {brief.photos.map((item, index) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className="h-auto p-0"
                    onClick={() => setPhotoIndex(index)}
                    aria-label={az.briefs.addPhoto}
                  >
                    <img
                      className="aspect-video w-full rounded-lg object-cover"
                      src={item.url}
                      alt={item.name}
                    />
                  </Button>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="rounded-xl border border-border bg-card p-5">
          <p className="label-mono !text-primary !tracking-normal">{az.briefs.title}</p>
          <dl className="mt-3 text-sm">
            <div className="flex justify-between gap-3 border-t border-border py-3">
              <dt className="label-mono !tracking-normal">{az.briefs.author}</dt>
              <dd>{brief.author}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border py-3">
              <dt className="label-mono !tracking-normal">{az.briefs.date}</dt>
              <dd>{brief.date.split("-").reverse().join(".")}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border py-3">
              <dt className="label-mono !tracking-normal">{az.briefs.statusLabel}</dt>
              <dd>{az.briefs.status[brief.status]}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border py-3">
              <dt className="label-mono !tracking-normal">{az.briefs.photos}</dt>
              <dd>{az.briefs.photoCount.replace("{count}", String(brief.photos.length))}</dd>
            </div>
            <div className="border-t border-border py-3">
              <dt className="label-mono !tracking-normal">
                {az.briefs.indexStatus[brief.indexStatus]}
              </dt>
              {brief.indexStatus === "processing" && (
                <dd className="mt-2 text-xs text-muted-foreground">
                  {brief.indexProgress.completedChunks} / {brief.indexProgress.totalChunks}
                </dd>
              )}
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            {data.previousId ? (
              <Button asChild variant="outline" className="rounded-full px-2">
                <Link to="/brifler/$id" params={{ id: data.previousId }}>
                  <ChevronLeft />
                  {az.briefs.previous}
                </Link>
              </Button>
            ) : (
              <Button disabled variant="outline">
                <ChevronLeft />
                {az.briefs.previous}
              </Button>
            )}
            {data.nextId ? (
              <Button asChild variant="outline" className="rounded-full px-2">
                <Link to="/brifler/$id" params={{ id: data.nextId }}>
                  {az.briefs.next}
                  <ChevronRight />
                </Link>
              </Button>
            ) : (
              <Button disabled variant="outline">
                {az.briefs.next}
                <ChevronRight />
              </Button>
            )}
          </div>
        </aside>
      </div>
      <Dialog
        open={Boolean(photo)}
        onOpenChange={(open) => {
          if (!open) setPhotoIndex(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogTitle>{photo?.name}</DialogTitle>
          {photo && (
            <img src={photo.url} alt={photo.name} className="max-h-[75vh] w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
