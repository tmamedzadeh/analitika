import * as React from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

export type MarkdownHighlight = { start: number; end: number } | null;

function hasSelectedRange(node: ExtraProps["node"], range: MarkdownHighlight): boolean {
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  return (
    range !== null &&
    start !== undefined &&
    end !== undefined &&
    start < range.end &&
    end > range.start
  );
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function highlightedBlock(
  tag: string,
  range: MarkdownHighlight,
): React.ComponentType<React.HTMLAttributes<HTMLElement> & ExtraProps> {
  return function HighlightedBlock({ node, children, ...props }) {
    const selected = node ? hasSelectedRange(node, range) : false;
    const elementProps = {
      ...props,
      "data-chunk-highlight": selected ? "true" : undefined,
      "data-chunk-range": selected ? `${range?.start}-${range?.end}` : undefined,
    } as React.HTMLAttributes<HTMLElement>;
    return React.createElement(tag, elementProps, children);
  };
}

export function BriefMarkdown({
  markdown,
  highlight = null,
}: {
  markdown: string;
  highlight?: MarkdownHighlight;
}) {
  const components: Components = {
    a: ({ href, children }) => {
      const url = safeHref(href);
      return url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <>{children}</>
      );
    },
    img: ({ alt }) => <span>{alt}</span>,
    p: highlightedBlock("p", highlight),
    h1: highlightedBlock("h1", highlight),
    h2: highlightedBlock("h2", highlight),
    h3: highlightedBlock("h3", highlight),
    h4: highlightedBlock("h4", highlight),
    h5: highlightedBlock("h5", highlight),
    h6: highlightedBlock("h6", highlight),
    li: highlightedBlock("li", highlight),
    blockquote: highlightedBlock("blockquote", highlight),
    table: ({ node, children, ...props }) => {
      const selected = node ? hasSelectedRange(node, highlight) : false;
      return (
        <table
          {...props}
          data-chunk-highlight={selected ? "true" : undefined}
          className={selected ? "rounded outline outline-2 outline-primary/50" : undefined}
        >
          {children}
        </table>
      );
    },
  };

  return (
    <div className="prose prose-sm max-w-none break-words leading-7 dark:prose-invert [&_[data-chunk-highlight=true]]:rounded [&_[data-chunk-highlight=true]]:bg-primary/10 [&_[data-chunk-highlight=true]]:outline [&_[data-chunk-highlight=true]]:outline-1 [&_[data-chunk-highlight=true]]:outline-primary/40">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
