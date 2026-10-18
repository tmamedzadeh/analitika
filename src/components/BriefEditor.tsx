import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { Upload, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { BriefCard } from "@/components/BriefCard";
import { useBriefs } from "@/components/BriefsProvider";
import { conflictingBrief, photoError, type Brief, type BriefPhoto } from "@/lib/briefs";

export function BriefEditor({ existing }: { existing?: Brief }) {
  const { briefs, save } = useBriefs();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(existing?.date ?? "2026-10-18");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [photos, setPhotos] = useState<BriefPhoto[]>(existing?.photos ?? []);
  const [error, setError] = useState("");
  const conflict = conflictingBrief(briefs, date, existing?.id);
  const preview: Brief = { id: existing?.id ?? "preview", date, title, body, photos, status: "draft" };
  function addPhotos(files: File[]) {
    const message = photoError(files, photos.length);
    if (message) { setError(message); return; }
    setError("");
    setPhotos(current => [...current, ...files.map(file => ({ name: file.name, url: URL.createObjectURL(file) }))]);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict) return;
    const intent = new FormData(event.currentTarget).get("intent");
    const brief: Brief = { ...preview, id: existing?.id ?? crypto.randomUUID(), title: title.trim(), body: body.trim(), status: intent === "draft" ? "draft" : "published" };
    if (!brief.title || !brief.body) { setError("Başlıq və brifin mətnini daxil edin."); return; }
    if (save(brief)) void navigate({ to: "/brifler/$id", params: { id: brief.id } });
  }
  return <Shell crumb="Gündəlik xülasələr" title={existing ? "Brifi redaktə et" : "Brif əlavə et"} badges={[]}>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <label className="text-sm font-medium">Tarix<input required className="field mt-2" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label className="text-sm font-medium">Başlıq<input required className="field mt-2" placeholder="[Brifin başlığı]" value={title} onChange={event => setTitle(event.target.value)} /></label>
        </div>
        {conflict && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"><p className="flex-1">Bu tarix üçün brif artıq mövcuddur. Hər tarixə yalnız bir brif əlavə etmək olar.</p><Button asChild variant="outline" className="rounded-full"><Link to="/brifler/$id" params={{ id: conflict.id }}>Mövcud brifi aç</Link></Button></div>}
        <label className="mt-5 block text-sm font-medium">Brifin mətni<textarea required className="field mt-2 min-h-80 resize-y" placeholder="Brifin mətnini bura yazın və ya yapışdırın. Mətn uzun ola bilər." value={body} onChange={event => setBody(event.target.value)} /></label>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Foto əlavə edin" onChange={event => { addPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <div className="mt-4" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addPhotos(Array.from(event.dataTransfer.files)); }}>
          <Button type="button" variant="outline" className="h-auto w-full flex-col whitespace-normal border-dashed border-primary/40 bg-accent/20 py-5 text-center text-muted-foreground" onClick={() => inputRef.current?.click()}><Upload /><span>Foto əlavə edin · JPG, PNG, WebP · 10 MB-a qədər · 10 ədədə qədər</span><span className="label-mono !tracking-normal">Fotolar brifin sonunda qalereya kimi göstərilir</span></Button>
        </div>
        {photos.length > 0 && <div className="mt-4 grid grid-cols-3 gap-3">{photos.map((photo, index) => <div key={photo.url} className="relative"><img src={photo.url} alt={photo.name} className="aspect-video w-full rounded-lg object-cover" /><Button type="button" size="icon" variant="secondary" aria-label={`${photo.name} sil`} className="absolute right-1 top-1" onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}><X /></Button></div>)}</div>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2"><Button type="submit" name="intent" value="published" disabled={Boolean(conflict)}>Təsdiqlə və dərc et</Button><Button type="submit" name="intent" value="draft" variant="outline" className="rounded-full" disabled={Boolean(conflict)}>Qaralama kimi saxla</Button><Button asChild variant="outline" className="rounded-full"><Link to="/">Ləğv et</Link></Button></div>
      </form>
      <aside><p className="label-mono mb-3 !tracking-normal">Kartın görünüşü</p>{date && <BriefCard brief={preview} preview />}</aside>
    </div>
  </Shell>;
}