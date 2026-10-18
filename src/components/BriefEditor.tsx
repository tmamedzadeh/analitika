import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { Upload, X } from "lucide-react";

import { BriefCard } from "@/components/BriefCard";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Shell } from "@/components/Shell";
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

type PhotoDraft = { id?: string; name: string; url: string; file?: File };

function validationMessage(path: string | undefined): string {
  if (path === "date") return az.briefs.validation.date;
  if (path === "title") return az.briefs.validation.title;
  if (path === "body") return az.briefs.validation.body;
  return az.briefs.validation.required;
}

export function BriefEditor({ existing }: { existing?: Brief }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(existing?.date ?? getBakuDate());
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [photos, setPhotos] = useState<PhotoDraft[]>(
    existing?.photos.map((photo) => ({ ...photo })) ?? [],
  );
  const [error, setError] = useState("");
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<"draft" | "published">("published");
  const existingPhotos = photos.filter((photo) => photo.id);
  const newPhotos = photos.flatMap((photo) => (photo.file ? [photo.file] : []));
  const preview: BriefListItem = {
    id: existing?.id ?? "preview",
    date,
    title: title.trim() || az.briefs.titlePlaceholder,
    excerpt: briefExcerpt(body) || az.briefs.bodyPlaceholder,
    status: "draft",
    indexStatus: "none",
    indexProgress: { percent: 0, totalChunks: 0, completedChunks: 0 },
    author: existing?.author ?? "admin",
    photoCount: photos.length,
    coverUrl: photos[0]?.url ?? null,
  };

  async function addPhotos(files: File[]) {
    const inputError = photoError(files, photos.length);
    if (inputError) {
      setError(inputError);
      return;
    }
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
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setConflictId(null);
    const parsed = briefInputSchema.safeParse({ date, title, body, status: intent });
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
      if (!saved.ok) {
        setConflictId(saved.conflictId);
        setError(az.briefs.conflict);
        return;
      }
      await navigate({ to: "/brifler/$id", params: { id: saved.briefId } });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const conflictMatch = new RegExp(`${az.briefs.conflict}:([0-9a-f-]{36})`, "i").exec(message);
      if (conflictMatch?.[1]) {
        setConflictId(conflictMatch[1]);
        setError(az.briefs.conflict);
      } else {
        setError(
          Object.values(az.briefs.validation).some((validation) => validation === message)
            ? message
            : az.briefs.saveFailed,
        );
      }
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

          {conflictId && (
            <div
              role="alert"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
            >
              <p className="flex-1">{az.briefs.conflict}</p>
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/brifler/$id" params={{ id: conflictId }}>
                  {az.briefs.openExisting}
                </Link>
              </Button>
            </div>
          )}

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
              <span className="label-mono !tracking-normal">{az.briefs.photoNote}</span>
            </Button>
          </div>
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
            <Button
              type="submit"
              name="intent"
              value="published"
              disabled={busy}
              onClick={() => setIntent("published")}
            >
              {busy && intent === "published" ? az.briefs.loading : az.briefs.publish}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="draft"
              variant="outline"
              className="rounded-full"
              disabled={busy}
              onClick={() => setIntent("draft")}
            >
              {busy && intent === "draft" ? az.briefs.loading : az.briefs.saveDraft}
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
          <p className="label-mono mb-3 !tracking-normal">{az.briefs.preview}</p>
          {date && <BriefCard brief={preview} preview />}
        </aside>
      </div>
    </Shell>
  );
}
