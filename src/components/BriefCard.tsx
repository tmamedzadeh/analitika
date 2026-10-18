import { Link } from "@tanstack/react-router";
import { Images } from "lucide-react";

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
      <div
        className={featured ? "flex min-w-0 flex-1 gap-4 sm:gap-6" : "flex min-w-0 flex-1 gap-4"}
      >
        <div
          className={
            featured
              ? "w-[4.5rem] shrink-0 border-r border-border pr-4 sm:w-24 sm:pr-5"
              : "w-[3.75rem] shrink-0 border-r border-border pr-3"
          }
        >
          <p
            className={
              featured
                ? "text-5xl font-semibold leading-none tracking-[-0.05em] text-primary sm:text-6xl"
                : "text-4xl font-semibold leading-none tracking-[-0.05em] text-primary"
            }
          >
            {date.day}
          </p>
          <p className="mt-2 text-xs font-medium capitalize leading-5 text-muted-foreground">
            {date.monthName}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <h2
            className={
              featured
                ? "text-lg font-semibold leading-6 tracking-[-0.01em] text-foreground sm:text-xl"
                : "text-base font-semibold leading-6 text-foreground"
            }
          >
            {brief.title}
          </h2>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
            {brief.excerpt}
          </p>
        </div>
      </div>
    </>
  );
  const className = `panel flex h-full flex-col gap-5 p-4 sm:p-5 ${
    featured
      ? "panel-glow sm:flex-row sm:items-stretch sm:gap-6 sm:p-6"
      : "min-h-48 transition-colors hover:border-primary/25 hover:shadow-sm"
  }`;

  return preview ? (
    <div className={className}>{content}</div>
  ) : (
    <Link
      to="/brifler/$id"
      params={{ id: brief.id }}
      className={`${className} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
    >
      {content}
    </Link>
  );
}
