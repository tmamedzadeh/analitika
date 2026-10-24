import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Shell } from "@/components/Shell";
import { ZirveLoader, ZirveSkeleton, ZirveActionLabel } from "@/components/ZirveLoader";
import { RichTextContent } from "@/components/RichTextContent";
import { DocumentImageUploadStatus } from "@/components/DocumentImageUploads";
import { PhotoGallery } from "@/components/PhotoGallery";
import { directionLabel } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import {
  deleteDocument,
  getDocumentDetails,
  retryDocumentIndexing,
} from "@/lib/documents.functions";

export const Route = createFileRoute("/_app/senedler_/$id")({
  validateSearch: z.object({ chunk: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Sənəd · Analitika" },
      { name: "description", content: "Sənəd mətninə və şəkillərə baxın." },
      { property: "og:title", content: "Sənəd · Analitika" },
      { property: "og:description", content: "Sənəd mətninə və şəkillərə baxın." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocumentPage,
});

function DocumentPage() {
  const { id } = Route.useParams();
  const { chunk: selectedChunkId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const parsedId = z.string().uuid().safeParse(id);
  const [busyAction, setBusyAction] = useState<"retry" | "delete" | null>(null);
  const busy = busyAction !== null;
  const [pageError, setPageError] = useState("");
  const documentQuery = useQuery({
    queryKey: ["document", id],
    enabled: parsedId.success,
    queryFn: () => {
      if (!parsedId.success) return Promise.resolve(null);
      return getDocumentDetails({ data: { documentId: parsedId.data } });
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const document = documentQuery.data;
  useEffect(() => {
    if (!selectedChunkId || !document) return;
    const frame = requestAnimationFrame(() => {
      globalThis.document.querySelector('[data-chunk-highlight="true"]')?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [document, selectedChunkId]);

  async function retry() {
    setBusyAction("retry");
    setPageError("");
    try {
      await retryDocumentIndexing({ data: { documentId: id } });
      await queryClient.invalidateQueries({ queryKey: ["document", id] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.documents.loadError);
    } finally {
      setBusyAction(null);
    }
  }

  async function remove() {
    if (!window.confirm(az.documents.deleteConfirm)) return;
    setBusyAction("delete");
    setPageError("");
    try {
      const result = await deleteDocument({ data: { documentId: id } });
      if (result.cleanupIncomplete) window.alert(az.documents.storageCleanupPending);
      await queryClient.invalidateQueries({ queryKey: ["documents", "recent"] });
      await navigate({ to: "/senedler" });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.documents.loadError);
    } finally {
      setBusyAction(null);
    }
  }

  if (!parsedId.success) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.missing} badges={[]}>
        <div className="panel space-y-4 p-6">
          <p role="status" className="text-sm text-muted-foreground">
            {az.documents.missing}
          </p>
          <Link to="/senedler" className="pill w-fit">
            {az.documents.backToList}
          </Link>
        </div>
      </Shell>
    );
  }
  if (documentQuery.isPending) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.loadingDocument} badges={[]}>
        <ZirveSkeleton label={az.loader.loading} rows={6} className="min-h-64" />
      </Shell>
    );
  }
  if (documentQuery.isError) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.loadError} badges={[]}>
        <div className="panel space-y-4 p-6">
          <p role="alert" className="text-sm text-destructive">
            {az.documents.loadError}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={documentQuery.isFetching}
              aria-busy={documentQuery.isFetching}
              onClick={() => void documentQuery.refetch()}
              className="pill"
            >
              {documentQuery.isFetching && <ZirveLoader variant="inline" label="" />}
              {az.actions.retry}
            </button>
            <Link to="/senedler" className="pill">
              {az.documents.backToList}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }
  if (!document) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.missing} badges={[]}>
        <div className="panel space-y-4 p-6">
          <p role="status" className="text-sm text-muted-foreground">
            {az.documents.missing}
          </p>
          <Link to="/senedler" className="pill w-fit">
            {az.documents.backToList}
          </Link>
        </div>
      </Shell>
    );
  }

  const selectedChunk = document.chunks.find((item) => item.id === selectedChunkId);

  return (
    <Shell
      crumb={az.navigation.documents}
      title={document.title}
      badges={[
        az.documents.status[document.status],
        az.documents.step[document.step as keyof typeof az.documents.step] ?? document.step,
        directionLabel(document.direction) ?? az.directions.unassigned,
        az.reliability.sourceBadge + " " + (document.sourceReliability ?? "Qiymətləndirilməyib"),
        az.reliability.informationBadge + " " + (document.infoCredibility ?? "Qiymətləndirilməyib"),
      ]}
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/senedler" className="pill">
          {az.documents.backToList}
        </Link>
        {document.status === "failed" && (
          <button
            type="button"
            disabled={busy}
            aria-busy={busyAction === "retry"}
            onClick={() => void retry()}
            className="pill"
          >
            <ZirveActionLabel
              busy={busyAction === "retry"}
              label={az.documents.retry}
              pendingLabel={az.documents.retrying}
            />
          </button>
        )}
        {document.canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="pill !border-destructive/50 !text-destructive"
          >
            {busyAction === "delete" && <ZirveLoader variant="inline" label="" />}
            {az.documents.delete}
          </button>
        )}
        {document.docDate && (
          <span className="label-mono">
            {new Date(`${document.docDate}T00:00:00`).toLocaleDateString("az-AZ")}
          </span>
        )}
      </div>
      {pageError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {pageError}
        </p>
      )}
      {document.error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-destructive/40 p-4 text-sm text-destructive"
        >
          {document.error}
        </p>
      )}

      {document.status === "processing" && (
        <div className="panel mb-5 p-4">
          <p className="label-mono">
            {az.documents.step[document.step as keyof typeof az.documents.step] ?? document.step}
          </p>
          <div className="mt-3 h-1 rounded-full bg-secondary">
            <div
              className="glow h-1 rounded-full bg-primary transition-[width]"
              style={{ width: `${getPercent(document.progress)}%` }}
            />
          </div>
        </div>
      )}
      <section
        className="panel mb-5 flex flex-wrap items-center justify-between gap-2 p-4"
        aria-label="Mətnin indekslənməsi"
      >
        <h2 className="font-semibold">Mətnin indekslənməsi</h2>
        <span role="status">
          {
            { queued: "Növbədə", processing: "Emal olunur", ready: "Hazırdır", failed: "Xəta" }[
              document.status
            ]
          }
        </span>
      </section>
      {document.imageUploadsEnabled && (
        <DocumentImageUploadStatus documentId={id} canManage={document.canManage} />
      )}

      <section className="panel p-6">
        <h2 className="mb-4 text-lg font-semibold">{az.documents.form.body}</h2>
        {document.body.trim() ? (
          <RichTextContent
            document={document.bodyRich}
            highlight={
              selectedChunk ? { start: selectedChunk.charStart, end: selectedChunk.charEnd } : null
            }
          />
        ) : (
          <p
            role="status"
            className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-muted-foreground"
          >
            {az.documents.emptyContent}
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">{az.documents.images}</h2>
        {document.photos.length === 0 ? (
          <div className="panel p-5 label-mono">{az.documents.noPhotos}</div>
        ) : (
          <PhotoGallery photos={document.photos} title={document.title} />
        )}
      </section>
    </Shell>
  );
}

function getPercent(progress: unknown): number {
  if (!progress || typeof progress !== "object" || !("percent" in progress)) return 0;
  return typeof progress.percent === "number" ? Math.max(0, Math.min(100, progress.percent)) : 0;
}
