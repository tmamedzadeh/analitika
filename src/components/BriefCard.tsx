import { Link } from "@tanstack/react-router";
import { briefDate, type Brief } from "@/lib/briefs";

export function BriefCard({ brief, featured = false, preview = false, showStatus = false }: { brief: Brief; featured?: boolean; preview?: boolean; showStatus?: boolean }) {
  const date = briefDate(brief.date);
  const content = <>
    <div className="w-24 shrink-0">
      <p className={featured ? "text-5xl font-light text-primary" : "text-4xl font-light text-primary"}>{date.day}</p>
      <p className="label-mono mt-2 !tracking-normal">{date.month}<br />{date.weekday}</p>
    </div>
    <div className="min-w-0 flex-1">
      {showStatus && <div className="mb-2 flex justify-end"><span className={`label-mono rounded-full border px-2 py-1 !tracking-normal ${brief.status === "draft" ? "border-warning/40 !text-warning" : "border-success/40 !text-success"}`}>{brief.status === "draft" ? "Qaralama" : "Təsdiqlənib"}</span></div>}
      <h2 className={featured ? "text-lg font-semibold" : "font-semibold"}>{brief.title || "[Brifin başlığı]"}</h2>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{brief.body || "[Brifin mətninin ilk sətirləri. Uzun mətn kartda qısaldılır.]"}</p>
    </div>
  </>;
  const className = `panel flex h-full gap-4 p-5 ${featured ? "min-h-36 border-primary/40 sm:gap-6 sm:p-6" : "min-h-32"}`;
  return preview ? <div className={className}>{content}</div> : <Link to="/brifler/$id" params={{ id: brief.id }} className={`${className} transition-colors hover:border-primary/50`}>{content}</Link>;
}