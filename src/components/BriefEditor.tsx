import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { Upload, X } from "lucide-react";

import { BriefCard } from "@/components/BriefCard";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Shell } from "@/components/Shell";
import { ZirveLoader, ZirveActionLabel } from "@/components/ZirveLoader";
import { Button } from "@/components/ui/button";
import { discardBriefUploads, prepareBriefUploads, saveBrief } from "@/lib/briefs.functions";
import {
  briefExcerpt,
  briefInputSchema,
  getBakuDate,
  inspectBriefPhoto,
  photoError,
  type Brief,
  type BriefListItem,
} from "@/lib/briefs";
import { az } from "@/lib/i18n/az";
import { clearanceValues, type Clearance } from "@/lib/classification";

type PhotoDraft = { id?: string; name: string; url: string; file?: File };

function validationMessage(path: string | undefined): string {
  if (path === "date") return az.briefs.validation.date;
  if (path === "title") return az.briefs.validation.title;
  if (path === "body") return az.briefs.validation.body;
  return az.briefs.validation.required;
}

export function BriefEditor({
  existing,
  formContext,
}: {
  existing?: Brief;
  formContext: { classifications: Clearance[]; canDeclassify: boolean };
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(existing?.date ?? getBakuDate());
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [classification, setClassification] = useState<Clearance>(
    existing?.classification ?? "open",
  );
  const classifications = formContext.classifications.filter(
    (value) =>
      !existing ||
      formContext.canDeclassify ||
      clearanceValues.indexOf(value) >= clearanceValues.indexOf(existing.classification),
  );
  const [photos, setPhotos] = useState<PhotoDraft[]>(
    existing?.photos.map((photo) => ({ ...photo })) ?? [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingPhotos, setCheckingPhotos] = useState(false);
  const existingPhotos = photos.filter((photo) => photo.id);
  const newPhotos = photos.flatMap((photo) => (photo.file ? [photo.file] : []));
  const preview: BriefListItem = {
    id: existing?.id ?? "preview",
    date,
    title: title.trim() || az.briefs.titlePlaceholder,
    excerpt: briefExcerpt(body) || az.briefs.bodyPlaceholder,
    status: "published",
    classification,
    indexStatus: "none",
    indexProgress: { percent: 0, totalChunks: 0, completedChunks: 0 },
    photoCount: photos.length,
    coverUrl: photos[0]?.url ?? null,
  };

  async function addPhotos(files: File[]) {
    const inputError = photoError(files, photos.length);
    if (inputError) {
      setError(inputError);
      return;
    }
    setCheckingPhotos(true);
    try {
      const inspected = await Promise.all(files.map(inspectBriefPhoto));
      if (inspected.some((item) => item === null)) {
        setError(az.briefs.validation.photoType);
        return;
      }
      setError("");
      setPhotos((current) => [
        ...current,
        ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file), file })),
      ]);
    } catch {
      setError(az.briefs.validation.photoType);
    } finally {
      setCheckingPhotos(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const parsed = briefInputSchema.safeParse({
      date,
      title,
      body,
      classification,
      status: "published",
    });
    if (!parsed.success) {
      setError(validationMessage(String(parsed.error.issues[0]?.path[0] ?? "")));
      return;
    }
    const fileError = photoError(newPhotos, existingPhotos.length);
    if (fileError) {
      setError(fileError);
      return;
    }

    setBusy(true);
    let prepared: Awaited<ReturnType<typeof prepareBriefUploads>> | undefined;
    try {
      const photoMetadata = await Promise.all(
        newPhotos.map(async (file) => {
          const inspected = await inspectBriefPhoto(file);
          if (!inspected) throw new Error(az.briefs.validation.photoType);
          return { name: file.name, mime: inspected.mime, size: inspected.size };
        }),
      );
      prepared = await prepareBriefUploads({
        data: {
          ...parsed.data,
          ...(existing ? { briefId: existing.id } : {}),
          keepAttachmentIds: existingPhotos.flatMap((photo) => (photo.id ? [photo.id] : [])),
          photos: photoMetadata,
        },
      });

      const uploadResults = await Promise.all(
        prepared.uploads.map(async (upload, index) => {
          const file = newPhotos[index];
          if (!file) return false;
          const response = await fetch(upload.url, {
            method: "PUT",
            headers: { "Content-Type": upload.mime },
            body: file,
          });
          return response.ok;
        }),
      );
      if (uploadResults.some((uploaded) => !uploaded)) {
        await discardBriefUploads({
          data: { briefId: prepared.briefId, keys: prepared.uploads.map((upload) => upload.key) },
        }).catch(() => undefined);
        setError(az.briefs.uploadFailed);
        return;
      }

      const saved = await saveBrief({
        data: {
          ...parsed.data,
          briefId: prepared.briefId,
          isNew: prepared.isNew,
          keepAttachmentIds: existingPhotos.flatMap((photo) => (photo.id ? [photo.id] : [])),
          uploads: prepared.uploads.map(({ url: _url, ...upload }) => upload),
        },
      });
      await navigate({ to: "/brifler/$id", params: { id: saved.briefId } });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(
        Object.values(az.briefs.validation).some((validation) => validation === message)
          ? message
          : az.briefs.saveFailed,
      );
      if (prepared?.uploads.length) {
        await discardBriefUploads({
          data: { briefId: prepared.briefId, keys: prepared.uploads.map((upload) => upload.key) },
        }).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      crumb={az.briefs.title}
      title={existing ? az.briefs.editTitle : az.briefs.addTitle}
      badges={[]}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <form
          onSubmit={(event) => void submit(event)}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <label className="text-sm font-medium">
              {az.briefs.date}
              <input
                required
                className="field mt-2"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              {az.briefs.titleField}
              <input
                required
                className="field mt-2"
                maxLength={500}
                placeholder={az.briefs.titlePlaceholder}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>

          <fieldset className="mt-5 grid gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">{az.briefs.classificationLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {classifications.map((value) => (
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
          <div className="mt-5 block text-sm font-medium">
            <p>{az.briefs.body}</p>
            <MarkdownEditor
              required
              maxLength={200_000}
              placeholder={az.briefs.bodyPlaceholder}
              value={body}
              onChange={setBody}
            />
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            aria-label={az.briefs.addPhoto}
            onChange={(event) => {
              void addPhotos(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <div
            className="mt-4"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void addPhotos(Array.from(event.dataTransfer.files));
            }}
          >
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full flex-col whitespace-normal border-dashed border-primary/40 bg-accent/20 py-5 text-center text-muted-foreground"
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              <span>{az.briefs.photoHint}</span>
              <span className="label-mono tracking-normal!">{az.briefs.photoNote}</span>
            </Button>
          </div>
          {checkingPhotos && (
            <ZirveLoader variant="compact" label={az.loader.processing} className="mt-4" />
          )}
          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {photos.map((photo, index) => (
                <div key={photo.id ?? photo.url} className="relative">
                  <img
                    src={photo.url}
                    alt={photo.name}
                    className="aspect-video w-full rounded-lg object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={az.briefs.removePhoto.replace("{name}", photo.name)}
                    className="absolute right-1 top-1"
                    onClick={() =>
                      setPhotos((current) =>
                        current.filter((_, photoIndex) => photoIndex !== index),
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              <ZirveActionLabel
                busy={busy}
                label={az.briefs.save}
                pendingLabel={az.briefs.loading}
              />
            </Button>
            <Button asChild variant="outline" className="rounded-full" disabled={busy}>
              <Link
                to={existing ? "/brifler/$id" : "/"}
                {...(existing ? { params: { id: existing.id } } : {})}
              >
                {az.briefs.cancel}
              </Link>
            </Button>
          </div>
        </form>
        <aside>
          <p className="label-mono mb-3 tracking-normal!">{az.briefs.preview}</p>
          {date && <BriefCard brief={preview} preview />}
        </aside>
      </div>
    </Shell>
  );
}
