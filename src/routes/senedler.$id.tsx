import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Shell } from "@/components/Shell";
import { BriefMarkdown } from "@/components/BriefMarkdown";
import { departmentLabel } from "@/lib/departments";
import { az } from "@/lib/i18n/az";
import {
  deleteDocument,
  getDocumentDetails,
  retryDocumentIndexing,
} from "@/lib/documents.functions";

export const Route = createFileRoute("/senedler/$id")({
  validateSearch: z.object({ chunk: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Sənəd · Analitika" },
      { name: "description", content: "Sənəd mətninə, fraqmentlərə və şəkillərə baxın." },
      { property: "og:title", content: "Sənəd · Analitika" },
      { property: "og:description", content: "Sənəd mətninə, fraqmentlərə və şəkillərə baxın." },
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
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const documentQuery = useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocumentDetails({ data: { documentId: id } }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const document = documentQuery.data;
  useEffect(() => {
    if (!selectedChunkId || !document) return;
    const frame = requestAnimationFrame(() => {
      globalThis.document
        .querySelector('[data-chunk-highlight="true"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [document, selectedChunkId]);

  async function retry() {
    setBusy(true);
    setPageError("");
    try {
      await retryDocumentIndexing({ data: { documentId: id } });
      await queryClient.invalidateQueries({ queryKey: ["document", id] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.documents.loadError);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(az.documents.deleteConfirm)) return;
    setBusy(true);
    setPageError("");
    try {
      await deleteDocument({ data: { documentId: id } });
      await queryClient.invalidateQueries({ queryKey: ["documents", "recent"] });
      await navigate({ to: "/senedler" });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.documents.loadError);
    } finally {
      setBusy(false);
    }
  }

  if (documentQuery.isPending) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.loadingDocument} badges={[]}>
        <div className="panel p-6 label-mono">{az.documents.loading}</div>
      </Shell>
    );
  }
  if (documentQuery.isError) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.loadError} badges={[]}>
        <div role="alert" className="panel p-6 text-destructive">
          {documentQuery.error.message}
        </div>
      </Shell>
    );
  }
  if (!document) {
    return (
      <Shell crumb={az.navigation.documents} title={az.documents.missing} badges={[]}>
        <Link to="/senedler" className="pill">
          {az.documents.backToList}
        </Link>
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
        ...(departmentLabel(document.department) ? [departmentLabel(document.department)!] : []),
        az.reliability.sourceBadge + " " + document.sourceReliability,
        az.reliability.informationBadge + " " + document.infoCredibility,
      ]}
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/senedler" className="pill">
          {az.documents.backToList}
        </Link>
        {document.status === "failed" && (
          <button type="button" disabled={busy} onClick={() => void retry()} className="pill">
            {busy ? az.documents.retrying : az.documents.retry}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="pill !border-destructive/50 !text-destructive"
        >
          {az.documents.delete}
        </button>
        {document.docDate && (
          <span className="label-mono">
            {new Date(`${document.docDate}T00:00:00`).toLocaleDateString("az-AZ")}
          </span>
        )}
        {document.tags.map((tag) => (
          <span key={tag} className="pill !py-1">
            {tag}
          </span>
        ))}
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

      <section className="panel p-6">
        <h2 className="mb-4 text-lg font-semibold">{az.documents.form.body}</h2>
        <BriefMarkdown
          markdown={document.body}
          highlight={
            selectedChunk ? { start: selectedChunk.charStart, end: selectedChunk.charEnd } : null
          }
        />
        {document.chunks.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="label-mono">
              {document.chunks.length} {az.documents.chunks}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{az.documents.chunkHelp}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {document.chunks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: "/senedler/$id",
                      params: { id },
                      search: { chunk: item.id },
                    })
                  }
                  className={`pill !py-1 ${item.id === selectedChunkId ? "pill-active" : ""}`}
                >
                  {item.ord + 1}. {item.sectionTitle || az.documents.plainText}
                  {item.isTable ? ` · ${az.documents.table}` : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">{az.documents.images}</h2>
        {document.photos.length === 0 ? (
          <div className="panel p-5 label-mono">{az.documents.noPhotos}</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {document.photos.map((photo) => (
              <a
                key={photo.id}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="panel overflow-hidden"
              >
                <img
                  src={photo.url}
                  alt={photo.name || document.title}
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
                {photo.name && <span className="block truncate p-3 text-sm">{photo.name}</span>}
              </a>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function getPercent(progress: unknown): number {
  if (!progress || typeof progress !== "object" || !("percent" in progress)) return 0;
  return typeof progress.percent === "number" ? Math.max(0, Math.min(100, progress.percent)) : 0;
}
