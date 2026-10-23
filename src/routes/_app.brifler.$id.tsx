import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { z } from "zod";

import { RichTextContent } from "@/components/RichTextContent";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { Shell } from "@/components/Shell";
import { ZirveLoader } from "@/components/ZirveLoader";
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

export const Route = createFileRoute("/_app/brifler/$id")({
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

  useEffect(() => {
    if (!search.chunk || !data?.brief.highlight) return;
    const frame = requestAnimationFrame(() => {
      globalThis.document.querySelector('[data-chunk-highlight="true"]')?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [search.chunk, data?.brief.highlight]);

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
      const result = await deleteBrief({ data: { briefId } });
      if (result.cleanupIncomplete) window.alert(az.briefs.storageCleanupPending);
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
      title={`${date.day} ${date.month}`}
      badges={[]}
      actions={
        <div className="flex flex-wrap gap-2">
          {data.canEdit && (
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/brifler/$id/redakte" params={{ id: brief.id }}>
                {az.briefs.edit}
              </Link>
            </Button>
          )}
          {data.canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="rounded-full"
                  disabled={deleting}
                  aria-busy={deleting}
                >
                  {deleting && <ZirveLoader variant="inline" label="" />}
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
          )}
        </div>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/">{az.briefs.backToList}</Link>
        </Button>
        <p className="label-mono tracking-normal!">
          {date.day} {date.month} · {date.weekday}
        </p>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <div className="mb-4">
          <ClassificationBadge classification={brief.classification} />
        </div>
        <article className="rounded-xl border border-border bg-card p-5 text-sm leading-7 sm:p-6">
          <h2 className="mb-5 text-sm font-medium text-muted-foreground">{brief.title}</h2>
          <RichTextContent document={brief.bodyRich} highlight={brief.highlight} />
        </article>
        {brief.photos.length > 0 && (
          <section className="mt-5">
            <p className="label-mono mb-3 tracking-normal!">{az.briefs.photos}</p>
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
