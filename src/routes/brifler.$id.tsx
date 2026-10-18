import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useBriefs } from "@/components/BriefsProvider";
import { briefDate, briefHead } from "@/lib/briefs";
export const Route = createFileRoute("/brifler/$id")({ head: () => briefHead("Brifi aç", "Gündəlik brifin tam mətni və əlavə olunmuş fotolar."), component: BriefDetail });
function BriefDetail() {
  const { id } = Route.useParams(); const { briefs } = useBriefs();
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const index = briefs.findIndex(item => item.id === id); const brief = briefs[index];
  if (!brief) return <Shell crumb="Gündəlik xülasələr" title="Brif tapılmadı" badges={[]}><Button asChild variant="outline"><Link to="/">Bütün briflər</Link></Button></Shell>;
  const date = briefDate(brief.date); const older = briefs[index + 1]; const newer = briefs[index - 1]; const photo = photoIndex === null ? undefined : brief.photos[photoIndex];
  return <Shell crumb="Gündəlik xülasələr" title={brief.title} badges={[]} actions={<Button asChild variant="outline" className="rounded-full"><Link to="/brifler/$id/redakte" params={{ id }}>Redaktə et</Link></Button>}>
    <div className="mb-5 flex flex-wrap items-center gap-3"><Button asChild variant="outline" className="rounded-full"><Link to="/"><ChevronLeft />Bütün briflər</Link></Button><p className="label-mono !tracking-normal">{date.day} {date.month} · {date.weekday}</p></div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <div><article className="rounded-xl border border-border bg-card p-5 text-sm leading-7 sm:p-6"><div className="whitespace-pre-wrap break-words">{brief.body}</div></article>{brief.photos.length > 0 && <section className="mt-5"><p className="label-mono mb-3 !tracking-normal">Əlavələr</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{brief.photos.map((item, i) => <Button key={item.url} variant="ghost" className="h-auto p-0" onClick={() => setPhotoIndex(i)} aria-label={`${item.name} aç`}><img className="aspect-video w-full rounded-lg object-cover" src={item.url} alt={item.name} /></Button>)}</div></section>}</div>
      <aside className="rounded-xl border border-border bg-card p-5"><p className="label-mono !text-primary !tracking-normal">Məlumat</p><dl className="mt-3 text-sm"><div className="flex justify-between border-t border-border py-3"><dt className="label-mono !tracking-normal">Tarix</dt><dd>{brief.date.split("-").reverse().join(".")}</dd></div><div className="flex justify-between border-t border-border py-3"><dt className="label-mono !tracking-normal">Əlavələr</dt><dd>{brief.photos.length} foto</dd></div></dl><div className="grid grid-cols-2 gap-2 border-t border-border pt-3">{older ? <Button asChild variant="outline" className="rounded-full px-2"><Link to="/brifler/$id" params={{ id: older.id }}><ChevronLeft />{briefDate(older.date).day} oktyabr</Link></Button> : <Button disabled variant="outline"><ChevronLeft />Əvvəlki</Button>}{newer ? <Button asChild variant="outline" className="rounded-full px-2"><Link to="/brifler/$id" params={{ id: newer.id }}>{briefDate(newer.date).day} oktyabr<ChevronRight /></Link></Button> : <Button disabled variant="outline">Növbəti<ChevronRight /></Button>}</div></aside>
    </div>
    <Dialog open={Boolean(photo)} onOpenChange={open => { if (!open) setPhotoIndex(null); }}><DialogContent className="max-w-4xl"><DialogTitle>{photo?.name}</DialogTitle>{photo && <img src={photo.url} alt={photo.name} className="max-h-[75vh] w-full object-contain" />}</DialogContent></Dialog>
  </Shell>;
}