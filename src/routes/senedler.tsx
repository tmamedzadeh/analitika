import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { Shell } from "@/components/Shell";
import {
  infoCredibilityLabels,
  infoCredibilityValues,
  sourceReliabilityLabels,
  sourceReliabilityValues,
  type InfoCredibility,
  type SourceReliability,
} from "@/lib/reliability";
import { departments } from "@/lib/departments";
import { az } from "@/lib/i18n/az";
import {
  completeDocumentUploads,
  createDocumentDraft,
  createDocumentSchema,
  discardDocumentDraft,
  listRecentDocuments,
  retryDocumentIndexing,
} from "@/lib/documents.functions";

const classifications = ["open", "secret", "top_secret", "special"] as const;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageSize = 10 * 1024 * 1024;

type DocumentSummary = Awaited<ReturnType<typeof listRecentDocuments>>[number];

export const Route = createFileRoute("/senedler")({
  head: () => ({
    meta: [
      { title: "Sənədlər · Analitika" },
      { name: "description", content: "Yeni sənəd əlavə edin və indeksləmə vəziyyətini izləyin." },
      { property: "og:title", content: "Sənədlər · Analitika" },
      {
        property: "og:description",
        content: "Yeni sənəd əlavə edin və indeksləmə vəziyyətini izləyin.",
      },
    ],
  }),
  component: AddDoc,
});

function isActive(document: DocumentSummary): boolean {
  return document.status === "queued" || document.status === "processing";
}

function progressPercent(progress: unknown): number {
  if (!progress || typeof progress !== "object" || !("percent" in progress)) return 0;
  const value = progress.percent;
  return typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
}

function AddDoc() {
  const formRef = useRef<HTMLFormElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [classification, setClassification] = useState<(typeof classifications)[number][0]>("open");
  const [sourceReliability, setSourceReliability] = useState<SourceReliability>("F");
  const [infoCredibility, setInfoCredibility] = useState<InfoCredibility>(6);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const documentsQuery = useQuery({
    queryKey: ["documents", "recent"],
    queryFn: () => listRecentDocuments(),
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 2000 : false),
  });

  function updatePhotos(files: FileList | null) {
    setPhotoError("");
    const selected = Array.from(files ?? []);
    if (selected.length > 10) {
      setPhotos([]);
      setPhotoError(az.documents.form.tooManyPhotos);
      return;
    }
    if (
      selected.some(
        (file) => !acceptedImageTypes.has(file.type) || file.size > maxImageSize || file.size === 0,
      )
    ) {
      setPhotos([]);
      setPhotoError(az.documents.form.invalidPhotos);
      return;
    }
    setPhotos(selected);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setFormError("");
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "");
    if (body.length > 500_000) {
      setFormError(az.documents.form.maxBody);
      return;
    }
    if (photoError) return;

    const input = createDocumentSchema.safeParse({
      title: String(formData.get("title") ?? ""),
      body,
      department: String(formData.get("department") ?? ""),
      docDate: String(formData.get("docDate") ?? "") || null,
      tags: String(formData.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      classification,
      sourceReliability,
      infoCredibility,
      photos: photos.map((file) => ({ name: file.name, mime: file.type, size: file.size })),
    });
    if (!input.success) {
      setFormError(input.error.issues[0]?.message ?? az.documents.form.invalidPhotos);
      return;
    }

    setSaving(true);
    let documentId: string | null = null;
    try {
      const draft = await createDocumentDraft({ data: input.data });
      documentId = draft.documentId;

      for (const [index, upload] of draft.uploads.entries()) {
        const file = photos[index];
        if (!file) throw new Error(az.documents.form.invalidPhotos);
        let response: Response;
        try {
          response = await fetch(upload.url, {
            method: "PUT",
            headers: { "content-type": file.type },
            body: file,
          });
        } catch {
          throw new Error(az.documents.form.photoUploadFailed);
        }
        if (!response.ok) throw new Error(az.documents.form.photoUploadFailed);
      }

      await completeDocumentUploads({ data: { documentId: draft.documentId } });
      setSaved(true);
      formRef.current?.reset();
      setPhotos([]);
      setClassification("open");
      setSourceReliability("F");
      setInfoCredibility(6);
      if (photoInputRef.current) photoInputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["documents", "recent"] });
    } catch (error) {
      console.error(error);
      setFormError(error instanceof Error ? error.message : az.documents.loadError);
      if (documentId) {
        try {
          await discardDocumentDraft({ data: { documentId } });
        } catch (cleanupError) {
          console.error(cleanupError);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["documents", "recent"] });
    } finally {
      setSaving(false);
    }
  }

  async function retry(documentId: string) {
    setRetryingId(documentId);
    setFormError("");
    try {
      await retryDocumentIndexing({ data: { documentId } });
      await queryClient.invalidateQueries({ queryKey: ["documents", "recent"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : az.documents.loadError);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Shell
      crumb="Sənədlər"
      title="Sənəd əlavə et"
      badges={["Sistem aktivdir", "İndeksləmə: fonda"]}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_352px]">
        <form ref={formRef} onSubmit={handleSubmit} className="panel space-y-5 p-6">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">{az.documents.form.title}</span>
            <input
              name="title"
              required
              maxLength={300}
              className="field"
              placeholder={az.documents.form.titlePlaceholder}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">{az.documents.form.body}</span>
            <textarea
              name="body"
              rows={7}
              required
              maxLength={500_000}
              className="field"
              placeholder={az.documents.form.bodyPlaceholder}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">
                {az.documents.form.department}
              </span>
              <select name="department" className="field" defaultValue="" required>
                <option value="" disabled>
                  {az.documents.form.departmentPlaceholder}
                </option>
                {departments.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.documents.form.date}</span>
              <input name="docDate" type="date" className="field" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.documents.form.tags}</span>
              <input
                name="tags"
                className="field"
                placeholder={az.documents.form.tagsPlaceholder}
              />
            </label>
          </div>
          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">
              {az.documents.form.classification}{" "}
              <span className="label-mono">· {az.documents.demo}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {classifications.map((value) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="classification"
                    value={value}
                    checked={classification === value}
                    onChange={() => setClassification(value)}
                    className="sr-only"
                  />
                  <span className={classification === value ? "pill pill-active" : "pill"}>
                    {az.documents.classification[value]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">
              {az.documents.form.sourceReliability}
            </legend>
            <div className="flex flex-wrap gap-2">
              {sourceReliabilityValues.map((value) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="sourceReliability"
                    value={value}
                    checked={sourceReliability === value}
                    onChange={() => setSourceReliability(value)}
                    className="sr-only"
                  />
                  <span className={sourceReliability === value ? "pill pill-active" : "pill"}>
                    {value} · {sourceReliabilityLabels[value]}
                  </span>
                </label>
              ))}
            </div>
            <p className="label-mono mt-1">{az.documents.form.sourceNote}</p>
          </fieldset>
          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">
              {az.documents.form.infoCredibility}
            </legend>
            <div className="flex flex-wrap gap-2">
              {infoCredibilityValues.map((value) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="infoCredibility"
                    value={value}
                    checked={infoCredibility === value}
                    onChange={() => setInfoCredibility(value)}
                    className="sr-only"
                  />
                  <span className={infoCredibility === value ? "pill pill-active" : "pill"}>
                    {value} · {infoCredibilityLabels[value]}
                  </span>
                </label>
              ))}
            </div>
            <p className="label-mono mt-1">{az.documents.form.infoNote}</p>
          </fieldset>
          <label className="block cursor-pointer rounded-xl border border-dashed border-primary/30 bg-accent/20 p-7 text-center">
            <input
              ref={photoInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => updatePhotos(event.currentTarget.files)}
            />
            <p className="text-sm">{az.documents.form.photos}</p>
            <p className="label-mono mt-1">{az.documents.form.photoNote}</p>
            {photos.length > 0 && (
              <p className="mt-2 text-sm">
                {photos.length} {az.documents.form.photoSelected}
              </p>
            )}
          </label>
          {(photoError || formError) && (
            <p role="alert" className="text-sm text-destructive">
              {photoError || formError}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-success">
              {az.documents.form.success}
            </p>
          )}
          <div className="flex gap-3">
            <button
              disabled={saving}
              className="glow rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? az.documents.form.saving : az.documents.form.save}
            </button>
            <button
              type="reset"
              disabled={saving}
              onClick={() => {
                setPhotos([]);
                setPhotoError("");
                setFormError("");
                setSaved(false);
                setClassification("open");
                setSourceReliability("F");
                setInfoCredibility(6);
                if (photoInputRef.current) photoInputRef.current.value = "";
              }}
              className="pill"
            >
              {az.documents.form.cancel}
            </button>
          </div>
        </form>

        <aside>
          <p className="label-mono mb-3">{az.documents.recent}</p>
          {documentsQuery.isPending ? (
            <div className="panel p-5 label-mono">{az.documents.loading}</div>
          ) : documentsQuery.isError ? (
            <div className="panel p-5 text-sm text-destructive">{az.documents.loadError}</div>
          ) : documentsQuery.data.length === 0 ? (
            <div className="panel p-5 label-mono">{az.documents.empty}</div>
          ) : (
            <div className="space-y-3">
              {documentsQuery.data.map((document) => {
                const percent = progressPercent(document.progress);
                return (
                  <div key={document.id} className="panel p-5">
                    <Link
                      to="/senedler/$id"
                      params={{ id: document.id }}
                      className="font-semibold hover:text-primary"
                    >
                      {document.title}
                    </Link>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`label-mono inline-flex rounded-full border px-3 py-1 ${
                          document.status === "ready"
                            ? "border-success/50 !text-success"
                            : document.status === "failed"
                              ? "border-destructive/50 !text-destructive"
                              : "border-warning/50 !text-warning"
                        }`}
                      >
                        {az.documents.status[document.status]}
                      </span>
                      <span className="label-mono">
                        {az.documents.step[document.step as keyof typeof az.documents.step] ??
                          document.step}
                      </span>
                    </div>
                    {isActive(document) && (
                      <div
                        className="mt-3 h-1 rounded-full bg-secondary"
                        aria-label={`${percent}%`}
                      >
                        <div
                          className="glow h-1 rounded-full bg-primary transition-[width]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                    {document.status === "ready" && (
                      <p className="label-mono mt-3">
                        {document.chunkCount} {az.documents.chunks}
                      </p>
                    )}
                    {document.status === "failed" && document.error && (
                      <p className="mt-3 text-sm text-destructive">{document.error}</p>
                    )}
                    {document.status === "failed" && (
                      <button
                        type="button"
                        disabled={retryingId === document.id}
                        onClick={() => void retry(document.id)}
                        className="pill mt-3 !py-1"
                      >
                        {retryingId === document.id ? az.documents.retrying : az.documents.retry}
                      </button>
                    )}
                    <p className="label-mono mt-3">
                      {new Date(document.createdAt).toLocaleDateString("az-AZ")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}
