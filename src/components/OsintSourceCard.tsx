import { az } from "@/lib/i18n/az";
import { originalSourceLanguageLabel } from "@/lib/osint-language";
import { safeOriginalSourceUrl } from "@/lib/osint-source-display";

export type OsintSourceCardData = {
  n: number;
  url: string;
  domain: string;
  originalTitle: string;
  originalLanguage: string | null;
  publishedAt: string | null;
};

export function OsintSourceCard({ source }: { source: OsintSourceCardData }) {
  const title = source.originalTitle.trim() || source.domain;
  const originalUrl = safeOriginalSourceUrl(source.url);
  const language = originalSourceLanguageLabel(source.originalLanguage);
  const publishedAt = source.publishedAt ? new Date(source.publishedAt) : null;
  const date =
    publishedAt && Number.isFinite(publishedAt.getTime())
      ? new Intl.DateTimeFormat("az-AZ", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(publishedAt)
      : null;
  const metadata = [source.domain, language, date].filter(Boolean).join(" · ");

  return (
    <article className="panel min-w-0 p-4" id={"osint-source-" + source.n}>
      <h2 className="line-clamp-3 break-words font-semibold leading-snug [overflow-wrap:anywhere]">
        <span className="cite ml-0! mr-1">{source.n}</span>
        {title}
      </h2>
      <p className="line-clamp-2 mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {metadata}
      </p>
      {originalUrl ? (
        <a
          className="pill mt-3 inline-flex"
          href={originalUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {az.osint.openOriginal} <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </article>
  );
}
