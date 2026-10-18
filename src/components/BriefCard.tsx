import { Link } from "@tanstack/react-router";

import { briefDate, type BriefListItem } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export function BriefCard({
  brief,
  featured = false,
  preview = false,
}: {
  brief: BriefListItem;
  featured?: boolean;
  preview?: boolean;
}) {
  const date = briefDate(brief.date);
  const content = (
    <>
      <div className="w-24 shrink-0">
        <p
          className={
            featured ? "text-5xl font-light text-primary" : "text-4xl font-light text-primary"
          }
        >
          {date.day}
        </p>
        <p className="label-mono mt-2 !tracking-normal">
          {date.month}
          <br />
          {date.weekday}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className={`label-mono rounded-full border px-2 py-1 !tracking-normal ${brief.status === "draft" ? "border-warning/40 !text-warning" : "border-success/40 !text-success"}`}
          >
            {az.briefs.status[brief.status]}
          </span>
          <span className="label-mono !tracking-normal">
            {az.briefs.photoCount.replace("{count}", String(brief.photoCount))}
          </span>
        </div>
        <h2 className={featured ? "text-lg font-semibold" : "font-semibold"}>{brief.title}</h2>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{brief.excerpt}</p>
      </div>
    </>
  );
  const className = `panel flex h-full gap-4 p-5 ${featured ? "min-h-36 border-primary/40 sm:gap-6 sm:p-6" : "min-h-32"}`;

  return preview ? (
    <div className={className}>{content}</div>
  ) : (
    <Link
      to="/brifler/$id"
      params={{ id: brief.id }}
      className={`${className} transition-colors hover:border-primary/50`}
    >
      {content}
    </Link>
  );
}
