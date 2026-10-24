import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { LocalizedDatePicker } from "@/components/LocalizedDatePicker";
import { RichTextEditor } from "@/components/RichTextEditor";
import { emptyRichDocument } from "@/lib/rich-text";
import { Shell } from "@/components/Shell";
import { ZirveActionLabel } from "@/components/ZirveLoader";
import {
  infoCredibilityLabels,
  infoCredibilityValues,
  sourceReliabilityLabels,
  sourceReliabilityValues,
  type InfoCredibility,
  type SourceReliability,
} from "@/lib/reliability";
import { directions } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import {
  prepareDocumentUploads,
  createDocumentSchema,
  getDocumentFormContext,
  saveDocument,
} from "@/lib/documents.functions";
import { createDocumentText, recoverDocumentText } from "@/lib/document-images.functions";
import { useDocumentImageUploads } from "@/lib/document-image-context";

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageSize = 10 * 1024 * 1024;

export const Route = createFileRoute("/_app/senedler_/yeni")({
  loader: () => getDocumentFormContext(),
  head: () => ({
    meta: [
      { title: "Məlumat bazası · Analitika" },
      { name: "description", content: "Yeni sənəd əlavə edin və indeksləmə vəziyyətini izləyin." },
      { property: "og:title", content: "Məlumat bazası · Analitika" },
      {
        property: "og:description",
        content: "Yeni sənəd əlavə edin və indeksləmə vəziyyətini izləyin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AddDoc,
});

function AddDoc() {
  const formContext = Route.useLoaderData();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const imageUploads = useDocumentImageUploads();
  const creationKey = useRef<string>(crypto.randomUUID());
  const photoIds = useRef(new WeakMap<File, string>());
  const preparedLegacy = useRef<Awaited<ReturnType<typeof prepareDocumentUploads>> | null>(null);
  const recoveryPointer = `zirve:document-creation:${formContext.actorId}`;
  useEffect(() => {
    if (!formContext.textFirst) return;
    let current = true;
    try {
      const key = localStorage.getItem(recoveryPointer);
      if (key && /^[0-9a-f-]{36}$/i.test(key)) {
        creationKey.current = key;
        void recoverDocumentText({ data: { creationKey: key } })
          .then((result) => {
            if (current && result && !("error" in result))
              void navigate({ to: "/senedler/$id", params: { id: result.documentId } });
          })
          .catch(() => {});
      }
    } catch {
      /* Storage can be disabled; server idempotency still applies in this tab. */
    }
    return () => {
      current = false;
    };
  }, [formContext.textFirst, recoveryPointer, navigate]);
  const [classification, setClassification] =
    useState<(typeof formContext.classifications)[number]>("open");
  const [sourceReliability, setSourceReliability] = useState<SourceReliability | null>(null);
  const [infoCredibility, setInfoCredibility] = useState<InfoCredibility | null>(null);
  const [docDate, setDocDate] = useState("");
  const [bodyRich, setBodyRich] = useState(emptyRichDocument);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [queuePending, setQueuePending] = useState(false);
  const [saving, setSaving] = useState(false);

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
    preparedLegacy.current = null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setFormError("");
    const formData = new FormData(event.currentTarget);
    if (photoError && !formContext.textFirst) return;

    const input = createDocumentSchema.safeParse({
      title: String(formData.get("title") ?? ""),
      bodyRich,
      direction: String(formData.get("direction") ?? ""),
      docDate: String(formData.get("docDate") ?? "") || null,
      classification,
      sourceReliability,
      infoCredibility,
      photos: photos.map((file) => ({ name: file.name, mime: file.type, size: file.size })),
    });
    if (!input.success) {
      setFormError(
        input.error.issues[0]?.path[0] === "bodyRich"
          ? "Mətni daxil edin və ölçüsünü yoxlayın."
          : "Məcburi sahələri düzgün doldurun.",
      );
      return;
    }

    setSaving(true);
    try {
      if (formContext.textFirst) {
        try {
          localStorage.setItem(recoveryPointer, creationKey.current);
        } catch {
          /* Optional opaque pointer only. */
        }
        const manifest = photos.map((file) => {
          let clientFileId = photoIds.current.get(file);
          if (!clientFileId) {
            clientFileId = crypto.randomUUID();
            photoIds.current.set(file, clientFileId);
          }
          return { clientFileId, name: file.name, mime: file.type as "image/png", size: file.size };
        });
        const result = await createDocumentText({
          data: { ...input.data, creationKey: creationKey.current, photos: manifest },
        });
        if ("error" in result) {
          setFormError(result.error);
          return;
        }
        setSaved(true);
        toast.success(
          photoError
            ? "Mətn saxlanıldı. Seçilmiş şəkillər qəbul edilmədi."
            : result.queueFailed
              ? az.documents.form.savedQueuePending
              : az.documents.form.success,
        );
        imageUploads?.start(
          result.documentId,
          new Map(manifest.map((entry, index) => [entry.clientFileId, photos[index]!])),
        );
        await queryClient.invalidateQueries({ queryKey: ["documents"] });
        try {
          await navigate({ to: "/senedler/$id", params: { id: result.documentId } });
          localStorage.removeItem(recoveryPointer);
        } catch {
          setFormError("Mətn saxlanılıb. Sənədi məlumat bazasından aça bilərsiniz.");
        }
        return;
      }
      const prepared =
        preparedLegacy.current ?? (await prepareDocumentUploads({ data: input.data }));
      preparedLegacy.current = prepared;

      for (const [index, upload] of prepared.uploads.entries()) {
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

      const result = await saveDocument({
        data: {
          ...input.data,
          documentId: prepared.documentId,
          uploads: prepared.uploads.map(
            ({ url: _url, attachmentId: _attachmentId, ...upload }) => upload,
          ),
        },
      });
      toast.success(
        result.queueFailed ? az.documents.form.savedQueuePending : az.documents.form.success,
      );
      setSaved(true);
      setQueuePending(result.queueFailed);
      formRef.current?.reset();
      setDocDate("");
      setBodyRich(emptyRichDocument());
      setPhotos([]);
      setClassification("open");
      setSourceReliability(null);
      setInfoCredibility(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await navigate({ to: "/senedler/$id", params: { id: result.documentId } });
    } catch (error) {
      console.error("Document upload request failed.");
      setFormError(
        "Nəticəni təsdiqləmək mümkün olmadı. Yenidən yaratmadan əvvəl məlumat bazasını yoxlayın.",
      );
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell
      crumb={az.navigation.documents}
      title={az.documentLibrary.addTitle}
      actions={
        <Link to="/senedler" className="pill">
          {az.navigation.documents}
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-4xl">
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
          <div className="block">
            <span className="block text-sm font-semibold">{az.documents.form.body}</span>
            <RichTextEditor
              disabled={saving}
              label={az.documents.form.body}
              maxLength={500_000}
              className="min-h-56"
              placeholder={az.documents.form.bodyPlaceholder}
              value={bodyRich}
              onChange={setBodyRich}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.directions.field}</span>
              <select name="direction" className="field" defaultValue="" required>
                <option value="" disabled>
                  {az.directions.placeholder}
                </option>
                {directions.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">{az.documents.form.date}</span>
              <LocalizedDatePicker
                name="docDate"
                value={docDate}
                onChange={setDocDate}
                placeholder={az.documents.form.datePlaceholder}
                clearable
                clearLabel={az.actions.clearDate}
              />
            </label>
          </div>
          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">
              {az.documents.form.classification}{" "}
            </legend>
            <div className="flex flex-wrap gap-2">
              {formContext.classifications.map((value) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="classification"
                    value={value}
                    checked={classification === value}
                    onChange={() => setClassification(value)}
                    className="peer sr-only"
                  />
                  <span
                    className={`${classification === value ? "pill pill-active" : "pill"} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`}
                  >
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
                    className="peer sr-only"
                  />
                  <span
                    className={`${sourceReliability === value ? "pill pill-active" : "pill"} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`}
                  >
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
                    className="peer sr-only"
                  />
                  <span
                    className={`${infoCredibility === value ? "pill pill-active" : "pill"} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`}
                  >
                    {value} · {infoCredibilityLabels[value]}
                  </span>
                </label>
              ))}
            </div>
            <p className="label-mono mt-1">{az.documents.form.infoNote}</p>
          </fieldset>
          <label
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                photoInputRef.current?.click();
              }
            }}
            className="block cursor-pointer rounded-xl border border-dashed border-primary/30 bg-accent/20 p-7 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
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
              {queuePending ? az.documents.form.savedQueuePending : az.documents.form.success}
            </p>
          )}
          <div className="flex gap-3">
            <button
              disabled={saving}
              aria-busy={saving}
              className="glow rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-60"
            >
              <ZirveActionLabel
                busy={saving}
                label={az.documents.form.save}
                pendingLabel={az.documents.form.saving}
              />
            </button>
            <button
              type="reset"
              disabled={saving}
              onClick={() => {
                setPhotos([]);
                setPhotoError("");
                setFormError("");
                setSaved(false);
                setDocDate("");
                setBodyRich(emptyRichDocument());
                setClassification("open");
                setSourceReliability(null);
                setInfoCredibility(null);
                if (photoInputRef.current) photoInputRef.current.value = "";
              }}
              className="pill"
            >
              {az.documents.form.cancel}
            </button>
          </div>
        </form>
      </div>
    </Shell>
  );
}
