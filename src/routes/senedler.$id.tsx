import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { Shell } from "@/components/Shell";
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
  const bodyParts = useMemo(() => {
    if (!document) return [];
    const markers = new Map<number, string[]>();
    const boundaries = new Set<number>([0, document.body.length]);
    for (const item of document.chunks) {
      if (
        item.charStart < 0 ||
        item.charEnd > document.body.length ||
        item.charStart > item.charEnd
      )
        continue;
      boundaries.add(item.charStart);
      boundaries.add(item.charEnd);
      markers.set(item.charStart, [...(markers.get(item.charStart) ?? []), item.id]);
    }
    const offsets = [...boundaries].sort((left, right) => left - right);
    const parts: Array<{ key: string; text?: string; anchor?: string; highlighted?: boolean }> = [];
    for (let index = 0; index < offsets.length; index += 1) {
      const start = offsets[index];
      if (start === undefined) continue;
      for (const marker of markers.get(start) ?? []) {
        parts.push({ key: `anchor-${marker}`, anchor: marker });
      }
      const end = offsets[index + 1];
      if (end === undefined || end <= start) continue;
      const text = document.body.slice(start, end);
      const selected = document.chunks.find((item) => item.id === selectedChunkId);
      parts.push({
        key: `text-${start}`,
        text,
        highlighted: Boolean(selected && start >= selected.charStart && start < selected.charEnd),
      });
    }
    return parts;
  }, [document, selectedChunkId]);

  useEffect(() => {
    if (!selectedChunkId || !document) return;
    globalThis.document
      .getElementById(selectedChunkId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      <Shell crumb="Sənədlər" title={az.documents.loadingDocument} badges={[]}>
        <div className="panel p-6 label-mono">{az.documents.loading}</div>
      </Shell>
    );
  }
  if (documentQuery.isError) {
    return (
      <Shell crumb="Sənədlər" title={az.documents.loadError} badges={[]}>
        <div role="alert" className="panel p-6 text-destructive">
          {documentQuery.error.message}
        </div>
      </Shell>
    );
  }
  if (!document) {
    return (
      <Shell crumb="Sənədlər" title={az.documents.missing} badges={[]}>
        <Link to="/senedler" className="pill">
          {az.documents.backToList}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      crumb="Sənədlər"
      title={document.title}
      badges={[
        az.documents.status[document.status],
        az.documents.step[document.step as keyof typeof az.documents.step] ?? document.step,
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
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-foreground">
          {bodyParts.map((part) =>
            part.anchor ? (
              <span key={part.key} id={part.anchor} className="scroll-mt-24" />
            ) : part.highlighted ? (
              <mark key={part.key} className="rounded bg-primary/25 text-inherit">
                {part.text}
              </mark>
            ) : (
              <span key={part.key}>{part.text}</span>
            ),
          )}
        </pre>
        {document.chunks.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="label-mono">
              {document.chunks.length} {az.documents.chunks}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {document.chunks.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`pill !py-1 ${item.id === selectedChunkId ? "pill-active" : ""}`}
                >
                  {item.ord + 1}. {item.sectionTitle || az.documents.plainText}
                  {item.isTable ? ` · ${az.documents.table}` : ""}
                </a>
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
