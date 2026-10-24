import * as React from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { az } from "@/lib/i18n/az";

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
  linkRenderer,
  remarkPlugins = [],
}: {
  markdown: string;
  highlight?: MarkdownHighlight;
  remarkPlugins?: NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
  linkRenderer?: (
    href: string | undefined,
    children: React.ReactNode,
    node: ExtraProps["node"],
  ) => React.ReactNode | undefined;
}) {
  const components: Components = {
    a: ({ href, children, node }) => {
      const customLink = linkRenderer?.(href, children, node);
      if (customLink !== undefined) return customLink;

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
        <div
          className="markdown-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={az.analytics.table}
        >
          <table
            {...props}
            data-chunk-highlight={selected ? "true" : undefined}
            className={selected ? "rounded outline-2 outline-primary/50" : undefined}
          >
            {children}
          </table>
        </div>
      );
    },
  };

  return (
    <div className="markdown-content max-w-none wrap-break-word leading-7 **:data-[chunk-highlight=true]:rounded **:data-[chunk-highlight=true]:bg-primary/10 **:data-[chunk-highlight=true]:outline **:data-[chunk-highlight=true]:outline-primary/40">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, ...remarkPlugins]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
