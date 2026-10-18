import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Shell } from "@/components/Shell";
import { departmentLabel } from "@/lib/departments";
import { az } from "@/lib/i18n/az";
import { infoCredibilityLabels, sourceReliabilityLabels } from "@/lib/reliability";
import {
  deleteInfoRequest,
  getInfoRequestDetails,
  listAnswerDocuments,
  setInfoRequestAnswerDocument,
  updateInfoRequestStatus,
} from "@/lib/requests.functions";
import { requestStatuses } from "@/lib/requests";

export const Route = createFileRoute("/sorgu/$id")({
  validateSearch: z.object({}),
  head: () => ({
    meta: [
      { title: `${az.requests.details} · ${az.requests.title}` },
      { name: "description", content: az.requests.description },
      { property: "og:title", content: `${az.requests.details} · ${az.requests.title}` },
      { property: "og:description", content: az.requests.description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InfoRequestPage,
});

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("az-AZ");
}

function formatSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InfoRequestPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const requestQuery = useQuery({
    queryKey: ["info-request", id],
    queryFn: () => getInfoRequestDetails({ data: { requestId: id } }),
    refetchInterval: 5000,
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", "answer-options"],
    queryFn: () => listAnswerDocuments(),
    staleTime: 60_000,
  });
  const request = requestQuery.data;

  async function changeStatus(status: (typeof requestStatuses)[number]) {
    setPageError("");
    try {
      await updateInfoRequestStatus({ data: { requestId: id, status } });
      await queryClient.invalidateQueries({ queryKey: ["info-request", id] });
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.requests.refreshFailed);
    }
  }

  async function changeAnswerDocument(answerDocumentId: string) {
    setPageError("");
    try {
      await setInfoRequestAnswerDocument({
        data: { requestId: id, answerDocumentId: answerDocumentId || null },
      });
      await queryClient.invalidateQueries({ queryKey: ["info-request", id] });
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.requests.refreshFailed);
      await queryClient.invalidateQueries({ queryKey: ["info-request", id] });
    }
  }

  async function remove() {
    if (!window.confirm(az.requests.deleteConfirm)) return;
    setBusy(true);
    setPageError("");
    try {
      await deleteInfoRequest({ data: { requestId: id } });
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
      await navigate({ to: "/sorgu" });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.requests.deleteFailed);
    } finally {
      setBusy(false);
    }
  }

  if (requestQuery.isPending) {
    return (
      <Shell crumb={az.requests.title} title={az.requests.loading} badges={[]}>
        <div className="panel p-6 label-mono">{az.requests.loading}</div>
      </Shell>
    );
  }
  if (requestQuery.isError) {
    return (
      <Shell crumb={az.requests.title} title={az.requests.listFailed} badges={[]}>
        <div role="alert" className="panel p-6 text-destructive">
          {az.requests.listFailed}
        </div>
      </Shell>
    );
  }
  if (!request) {
    return (
      <Shell crumb={az.requests.title} title={az.requests.missing} badges={[]}>
        <Link to="/sorgu" className="pill">
          {az.requests.backToList}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      crumb={az.requests.title}
      title={request.details.trim().split(/\s+/).slice(0, 8).join(" ")}
      badges={[
        az.requests.status[request.status as keyof typeof az.requests.status],
        displayDate(request.requestDate),
      ]}
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/sorgu" className="pill">
          {az.requests.backToList}
        </Link>
        {request.answerDocumentId && (
          <Link to="/senedler/$id" params={{ id: request.answerDocumentId }} className="pill">
            {az.requests.openDocument}
          </Link>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="pill !border-destructive/50 !text-destructive"
        >
          {az.requests.delete}
        </button>
      </div>

      {pageError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {pageError}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_352px]">
        <section className="panel space-y-5 p-6">
          <Detail
            label={az.requests.department}
            value={departmentLabel(request.department) ?? request.department}
          />
          <Detail label={az.requests.date} value={displayDate(request.requestDate)} />
          <Detail
            label={az.requests.urgencyLabel}
            value={az.requests.urgency[request.urgency as keyof typeof az.requests.urgency]}
          />
          <Detail label={az.requests.purpose} value={request.purpose} />
          <Detail label={az.requests.detailsLabel} value={request.details} preserveNewlines />
          <Detail
            label={az.requests.sourceReliability}
            value={`${request.sourceReliability} · ${sourceReliabilityLabels[request.sourceReliability as keyof typeof sourceReliabilityLabels]}`}
          />
          <Detail
            label={az.requests.infoCredibility}
            value={`${request.infoCredibility} · ${infoCredibilityLabels[request.infoCredibility as keyof typeof infoCredibilityLabels]}`}
          />
          {request.note && (
            <Detail label={az.requests.note} value={request.note} preserveNewlines />
          )}

          <div className="border-t border-border pt-5">
            <h2 className="mb-3 text-lg font-semibold">{az.requests.attachments}</h2>
            {request.attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{az.requests.noAttachments}</p>
            ) : (
              <ul className="space-y-2">
                {request.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm hover:border-primary/40"
                    >
                      <span className="min-w-0 truncate text-primary">{attachment.name}</span>
                      <span className="label-mono">{formatSize(attachment.size)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="panel space-y-4 p-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">{az.requests.statusLabel}</span>
            <select
              className="field"
              value={request.status}
              onChange={(event) =>
                void changeStatus(event.currentTarget.value as (typeof requestStatuses)[number])
              }
            >
              {requestStatuses.map((status) => (
                <option key={status} value={status}>
                  {az.requests.status[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">{az.requests.answerDocument}</span>
            <select
              className="field"
              value={request.answerDocumentId ?? ""}
              onChange={(event) => void changeAnswerDocument(event.currentTarget.value)}
            >
              <option value="">{az.requests.noAnswerDocument}</option>
              {(documentsQuery.data ?? []).map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                  {document.docDate ? ` · ${displayDate(document.docDate)}` : ""}
                </option>
              ))}
            </select>
          </label>
          {documentsQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              {az.requests.refreshFailed}
            </p>
          )}
          {!documentsQuery.isLoading && (documentsQuery.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">{az.requests.noDocuments}</p>
          )}
          {request.answerDocumentId && (
            <div className="rounded-lg border border-primary/30 bg-accent/20 p-3">
              <p className="label-mono">{az.requests.answerDocument}</p>
              <p className="mt-1 text-sm font-medium">{request.answerDocumentTitle}</p>
              <Link
                to="/senedler/$id"
                params={{ id: request.answerDocumentId }}
                className="pill mt-3 inline-flex !py-1"
              >
                {az.requests.openDocument}
              </Link>
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}

function Detail({
  label,
  value,
  preserveNewlines = false,
}: {
  label: string;
  value: string;
  preserveNewlines?: boolean;
}) {
  return (
    <div>
      <h2 className="label-mono mb-1">{label}</h2>
      <p className={`text-sm leading-6 ${preserveNewlines ? "whitespace-pre-wrap" : ""}`}>
        {value}
      </p>
    </div>
  );
}
