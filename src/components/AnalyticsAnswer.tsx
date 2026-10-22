import { BriefMarkdown } from "./BriefMarkdown";
import { az } from "@/lib/i18n/az";

type CitationTarget = { n: number; available?: boolean };

export function AnalyticsAnswer({
  answer,
  sources,
}: {
  answer: string;
  sources: readonly CitationTarget[];
}) {
  // Ignore any model-authored URL, including URLs attached to citation labels.
  const markdown = answer.replace(/\[(\d+)\](?:\([^\r\n)]*\))?/gu, "[$1](#citation-$1)");
  return (
    <BriefMarkdown
      markdown={markdown}
      linkRenderer={(href, children) => {
        const match = /^#citation-(\d+)$/u.exec(href ?? "");
        if (!match) return <>{children}</>;
        const source = sources.find(
          (candidate) => candidate.n === Number(match[1]) && candidate.available !== false,
        );
        return source ? (
          <a
            className="cite"
            href={`#source-${source.n}`}
            aria-label={az.analytics.openSource.replace("{n}", String(source.n))}
          >
            [{children}]
          </a>
        ) : (
          <span className="cite">[{children}]</span>
        );
      }}
    />
  );
}
