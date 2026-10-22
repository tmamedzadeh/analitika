import { BriefMarkdown } from "./BriefMarkdown";
import { az } from "@/lib/i18n/az";
import { modelDisplayName } from "@/lib/ai";

type CitationTarget = { n: number; available?: boolean };

export function AnalyticsAnswer({
  answer,
  sources,
  model,
}: {
  answer: string;
  sources: readonly CitationTarget[];
  model?: string | null | undefined;
}) {
  // Ignore any model-authored URL, including URLs attached to citation labels.
  const markdown = answer.replace(/\[(\d+)\](?:\([^\r\n)]*\))?/gu, "[$1](#citation-$1)");
  return (
    <div>
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
    {model && answer !== az.analytics.noSources && <p className="mt-4 text-xs text-muted-foreground">{az.ai.generatedBy.replace("{model}", modelDisplayName(model))}</p>}
    </div>
  );
}
