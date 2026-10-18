import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { LocalizedDatePicker } from "@/components/LocalizedDatePicker";
import { Shell } from "@/components/Shell";
import { ZirveLoader } from "@/components/ZirveLoader";
import { departments, departmentLabel } from "@/lib/departments";
import { az } from "@/lib/i18n/az";
import {
  infoCredibilityLabels,
  infoCredibilityValues,
  sourceReliabilityLabels,
  sourceReliabilityValues,
  type InfoCredibility,
  type SourceReliability,
} from "@/lib/reliability";
import {
  completeInfoRequestUploads,
  createInfoRequestDraft,
  discardInfoRequestDraft,
  listAnswerDocuments,
  listInfoRequests,
  setInfoRequestAnswerDocument,
  updateInfoRequestStatus,
} from "@/lib/requests.functions";
import {
  infoRequestInputSchema,
  requestMaxAttachmentSize,
  requestMaxAttachments,
  requestMimeFromName,
  requestStatuses,
  requestUrgencies,
} from "@/lib/requests";

export const Route = createFileRoute("/sorgu")({
  head: () => ({
    meta: [
      { title: `${az.requests.title} · Analitika` },
      { name: "description", content: az.requests.description },
      { property: "og:title", content: `${az.requests.title} · Analitika` },
      { property: "og:description", content: az.requests.description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Sorgu,
});

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function requestTopic(details: string): string {
  const firstWords = details.trim().split(/\s+/).slice(0, 9).join(" ");
  return firstWords.length > 88 ? firstWords.slice(0, 85) + "…" : firstWords;
}

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("az-AZ");
}

function Sorgu() {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [urgency, setUrgency] = useState<(typeof requestUrgencies)[number]>("normal");
  const [sourceReliability, setSourceReliability] = useState<SourceReliability>("F");
  const [infoCredibility, setInfoCredibility] = useState<InfoCredibility>(6);
  const [requestDate, setRequestDate] = useState(() => localToday());
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState("");
  const [pageError, setPageError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRequest, setUpdatingRequest] = useState<{
    requestId: string;
    kind: "status" | "answer";
  } | null>(null);

  const requestsQuery = useQuery({
    queryKey: ["info-requests"],
    queryFn: () => listInfoRequests(),
    refetchInterval: 5000,
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", "answer-options"],
    queryFn: () => listAnswerDocuments(),
    staleTime: 60_000,
  });

  function updateFiles(fileList: FileList | null) {
    setFormError("");
    const selected = Array.from(fileList ?? []);
    if (selected.length > requestMaxAttachments) {
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFormError(az.requests.form.tooManyFiles);
      return;
    }
    if (
      selected.some(
        (file) =>
          file.size === 0 ||
          file.size > requestMaxAttachmentSize ||
          requestMimeFromName(file.name) === null,
      )
    ) {
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFormError(az.requests.form.invalidFiles);
      return;
    }
    setFiles(selected);
  }

  function resetForm() {
    formRef.current?.reset();
    setUrgency("normal");
    setSourceReliability("F");
    setInfoCredibility(6);
    setRequestDate(localToday());
    setFiles([]);
    setFormError("");
    setPageError("");
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess(false);
    setFormError("");
    setPageError("");
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    const parsed = infoRequestInputSchema.safeParse({
      department: String(formData.get("department") ?? ""),
      requestDate: String(formData.get("requestDate") ?? ""),
      urgency,
      purpose: String(formData.get("purpose") ?? ""),
      details: String(formData.get("details") ?? ""),
      sourceReliability,
      infoCredibility,
      note: String(formData.get("note") ?? ""),
      attachments: files.map((file) => ({
        name: file.name,
        mime: requestMimeFromName(file.name),
        size: file.size,
      })),
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? az.requests.validation.required);
      return;
    }

    setSaving(true);
    let requestId: string | null = null;
    try {
      const draft = await createInfoRequestDraft({
        data: { ...parsed.data, note: parsed.data.note ?? "" },
      });
      requestId = draft.requestId;
      try {
        for (const [index, upload] of draft.uploads.entries()) {
          const file = files[index];
          if (!file) throw new Error(az.requests.form.fileUploadFailed);
          let response: Response;
          try {
            response = await fetch(upload.url, {
              method: "PUT",
              headers: { "content-type": upload.mime },
              body: file,
            });
          } catch {
            throw new Error(az.requests.form.fileUploadFailed);
          }
          if (!response.ok) throw new Error(az.requests.form.fileUploadFailed);
        }
        await completeInfoRequestUploads({ data: { requestId } });
      } catch (error) {
        await discardInfoRequestDraft({ data: { requestId } }).catch(() => undefined);
        throw error;
      }

      resetForm();
      setSuccess(true);
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : az.requests.form.fileUploadFailed);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(requestId: string, status: (typeof requestStatuses)[number]) {
    setUpdatingRequest({ requestId, kind: "status" });
    setPageError("");
    try {
      await updateInfoRequestStatus({ data: { requestId, status } });
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.requests.refreshFailed);
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } finally {
      setUpdatingRequest(null);
    }
  }

  async function changeAnswerDocument(requestId: string, answerDocumentId: string) {
    setUpdatingRequest({ requestId, kind: "answer" });
    setPageError("");
    try {
      await setInfoRequestAnswerDocument({
        data: { requestId, answerDocumentId: answerDocumentId || null },
      });
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : az.requests.refreshFailed);
      await queryClient.invalidateQueries({ queryKey: ["info-requests"] });
    } finally {
      setUpdatingRequest(null);
    }
  }

  const requests = requestsQuery.data ?? [];
  const openCount = requests.filter(
    (request) => request.status === "new" || request.status === "in_progress",
  ).length;

  return (
    <Shell
      crumb={az.requests.title}
      title={az.requests.title}
      badges={[az.requests.openCount.replace("{count}", String(openCount))]}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_352px]">
        <section>
          <h2 className="mb-3 text-lg font-semibold">{az.requests.formTitle}</h2>
          <form
            ref={formRef}
            noValidate
            onSubmit={(event) => void submitRequest(event)}
            className="panel space-y-5 p-6"
          >
            <p className="text-sm text-muted-foreground">{az.requests.description}</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold">
                  {az.requests.form.department}
                </span>
                <select name="department" className="field" defaultValue="" required>
                  <option value="" disabled>
                    {az.requests.form.departmentPlaceholder}
                  </option>
                  {departments.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold">{az.requests.form.date}</span>
                <LocalizedDatePicker
                  name="requestDate"
                  value={requestDate}
                  onChange={setRequestDate}
                  placeholder={az.requests.form.datePlaceholder}
                  required
                />
              </label>
            </div>

            <fieldset className="border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-semibold">{az.requests.form.urgency}</legend>
              <div className="flex flex-wrap gap-2">
                {requestUrgencies.map((value) => (
                  <label key={value} className="cursor-pointer">
                    <input
                      className="peer sr-only"
                      type="radio"
                      name="urgency"
                      value={value}
                      checked={urgency === value}
                      onChange={() => setUrgency(value)}
                    />
                    <span
                      className={`pill peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${urgency === value ? "pill-active" : ""}`}
                    >
                      {az.requests.urgency[value]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.requests.form.purpose}</span>
              <textarea
                name="purpose"
                rows={3}
                className="field"
                placeholder={az.requests.form.purposePlaceholder}
                required
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.requests.form.details}</span>
              <textarea
                name="details"
                rows={5}
                className="field"
                placeholder={az.requests.form.detailsPlaceholder}
                required
              />
            </label>

            <RatingRadios
              name="sourceReliability"
              legend={az.requests.form.sourceReliability}
              note={az.requests.form.sourceReliabilityNote}
              values={sourceReliabilityValues}
              labels={sourceReliabilityLabels}
              selected={sourceReliability}
              onSelect={(value) => setSourceReliability(value as SourceReliability)}
            />
            <RatingRadios
              name="infoCredibility"
              legend={az.requests.form.infoCredibility}
              note={az.requests.form.infoCredibilityNote}
              values={infoCredibilityValues}
              labels={infoCredibilityLabels}
              selected={infoCredibility}
              onSelect={(value) => setInfoCredibility(value as InfoCredibility)}
            />

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.requests.form.note}</span>
              <textarea
                name="note"
                rows={3}
                className="field"
                placeholder={az.requests.form.notePlaceholder}
              />
            </label>

            <div>
              <label className="mb-2 block text-sm font-semibold" htmlFor="request-attachments">
                {az.requests.form.attachments}
              </label>
              <input
                ref={fileInputRef}
                id="request-attachments"
                type="file"
                multiple
                accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
                className="field file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm"
                onChange={(event) => updateFiles(event.currentTarget.files)}
              />
              <p className="label-mono mt-2">{az.requests.form.attachmentsHint}</p>
              {files.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        className="pill !py-1"
                        aria-label={`${az.requests.form.removeFile}: ${file.name}`}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((_, fileIndex) => fileIndex !== index),
                          )
                        }
                      >
                        {az.requests.form.removeFile}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {formError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
              >
                {formError}
              </p>
            )}
            {success && (
              <p
                role="status"
                className="rounded-lg border border-primary/30 p-3 text-sm text-primary"
              >
                {az.requests.form.submitSuccess}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                className="glow rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                type="submit"
                disabled={saving}
              >
                {saving && <ZirveLoader variant="inline" label="" />}
                {saving ? az.requests.form.submitting : az.requests.form.submit}
              </button>
              <button className="pill" type="button" disabled={saving} onClick={resetForm}>
                {az.requests.form.cancel}
              </button>
            </div>
          </form>
        </section>

        <aside>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="label-mono">{az.requests.listTitle}</h2>
            <span className="label-mono">{requests.length}</span>
          </div>
          {pageError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {pageError}
            </p>
          )}
          {requestsQuery.isPending || documentsQuery.isPending ? (
            <ZirveLoader variant="compact" label={az.requests.loading} />
          ) : requestsQuery.isError ? (
            <div role="alert" className="panel p-5 text-sm text-destructive">
              {az.requests.listFailed}
            </div>
          ) : requests.length === 0 ? (
            <div className="panel p-5 text-sm text-muted-foreground">{az.requests.listEmpty}</div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <article key={request.id} className="panel p-5">
                  <Link
                    to="/sorgu/$id"
                    params={{ id: request.id }}
                    className="font-semibold hover:text-primary"
                  >
                    {requestTopic(request.details)}
                  </Link>
                  <p className="label-mono mt-2">
                    {[
                      departmentLabel(request.department) ?? request.department,
                      displayDate(request.requestDate),
                      az.requests.urgency[request.urgency as keyof typeof az.requests.urgency],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <label className="mt-3 block">
                    <span className="mb-1 flex items-center gap-2">
                      <span className="sr-only">
                        {az.requests.statusLabel} · {requestTopic(request.details)}
                      </span>
                      {updatingRequest?.requestId === request.id &&
                        updatingRequest.kind === "status" && (
                          <>
                            <span className="sr-only">{az.loader.processing}</span>
                            <ZirveLoader variant="inline" label="" />
                          </>
                        )}
                    </span>
                    <select
                      className="field py-2 text-sm"
                      value={request.status}
                      disabled={updatingRequest?.requestId === request.id}
                      onChange={(event) =>
                        void changeStatus(
                          request.id,
                          event.currentTarget.value as (typeof requestStatuses)[number],
                        )
                      }
                    >
                      {requestStatuses.map((status) => (
                        <option key={status} value={status}>
                          {az.requests.status[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 flex items-center gap-2">
                      <span className="sr-only">
                        {az.requests.answerDocument} · {requestTopic(request.details)}
                      </span>
                      {updatingRequest?.requestId === request.id &&
                        updatingRequest.kind === "answer" && (
                          <ZirveLoader variant="inline" label="" />
                        )}
                    </span>
                    <select
                      className="field py-2 text-sm"
                      value={request.answerDocumentId ?? ""}
                      disabled={
                        documentsQuery.isPending || updatingRequest?.requestId === request.id
                      }
                      onChange={(event) =>
                        void changeAnswerDocument(request.id, event.currentTarget.value)
                      }
                    >
                      <option value="">{az.requests.noAnswerDocument}</option>
                      {(documentsQuery.data ?? []).map((document) => (
                        <option key={document.id} value={document.id}>
                          {document.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {request.answerDocumentId && (
                    <Link
                      to="/senedler/$id"
                      params={{ id: request.answerDocumentId }}
                      className="pill mt-3 inline-flex !py-1"
                    >
                      {az.requests.openDocument}
                    </Link>
                  )}
                  <Link
                    to="/sorgu/$id"
                    params={{ id: request.id }}
                    className="label-mono mt-3 block text-primary hover:underline"
                  >
                    {az.requests.details}
                  </Link>
                </article>
              ))}
            </div>
          )}
          {documentsQuery.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {az.requests.refreshFailed}
            </p>
          )}
        </aside>
      </div>
    </Shell>
  );
}

function RatingRadios<Value extends string | number>({
  name,
  legend,
  note,
  values,
  labels,
  selected,
  onSelect,
}: {
  name: string;
  legend: string;
  note: string;
  values: readonly Value[];
  labels: Record<Value, string>;
  selected: Value;
  onSelect: (value: Value) => void;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <label key={value} className="cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={value}
              checked={selected === value}
              onChange={() => onSelect(value)}
            />
            <span
              className={`pill peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${selected === value ? "pill-active" : ""}`}
            >
              {value} · {labels[value]}
            </span>
          </label>
        ))}
      </div>
      <p className="label-mono mt-2">{note}</p>
    </fieldset>
  );
}
