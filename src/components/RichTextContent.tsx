import { Fragment, useMemo, type ReactNode } from "react";
import { projectRichText, safeRichHref, type RichDocument, type RichNode } from "@/lib/rich-text";

/** React builds every element and escapes every text node. No HTML injection API. */
export function RichTextContent({
  document,
  highlight,
}: {
  document: RichDocument;
  highlight?: { start: number; end: number } | null;
}) {
  const projection = useMemo(() => projectRichText(document), [document]);
  function render(node: RichNode, path: string): ReactNode {
    if (node.type === "text" || node.type === "hardBreak") {
      const text = node.type === "hardBreak" ? "\n" : (node.text ?? "");
      const span = projection.spans.get(path);
      let content: ReactNode = node.type === "hardBreak" ? <br /> : text;
      if (span && highlight && span.start < highlight.end && span.end > highlight.start) {
        const from = Math.max(0, highlight.start - span.start);
        const to = Math.min(text.length, highlight.end - span.start);
        content = (
          <>
            {text.slice(0, from)}
            <mark data-chunk-highlight="true" className="rounded-sm bg-primary/20 text-inherit">
              {node.type === "hardBreak" ? <br /> : text.slice(from, to)}
            </mark>
            {text.slice(to)}
          </>
        );
      }
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") content = <strong>{content}</strong>;
        if (mark.type === "italic") content = <em>{content}</em>;
        if (mark.type === "underline") content = <u>{content}</u>;
        if (mark.type === "link") {
          const href = safeRichHref(mark.attrs?.href);
          if (href)
            content = (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {content}
              </a>
            );
        }
      }
      return <Fragment key={path}>{content}</Fragment>;
    }
    const children = node.content?.map((child, i) => render(child, `${path}.${i}`));
    switch (node.type) {
      case "doc":
        return <Fragment key={path}>{children}</Fragment>;
      case "paragraph":
        return <p key={path}>{children?.length ? children : <br />}</p>;
      case "heading":
        return node.attrs?.level === 1 ? (
          <h1 key={path}>{children}</h1>
        ) : node.attrs?.level === 2 ? (
          <h2 key={path}>{children}</h2>
        ) : (
          <h3 key={path}>{children}</h3>
        );
      case "blockquote":
        return <blockquote key={path}>{children}</blockquote>;
      case "bulletList":
        return <ul key={path}>{children}</ul>;
      case "orderedList":
        return (
          <ol key={path} start={node.attrs?.start ?? 1} type={node.attrs?.type}>
            {children}
          </ol>
        );
      case "listItem":
        return <li key={path}>{children}</li>;
      default:
        return null;
    }
  }
  return <div className="rich-document">{render(document, "0")}</div>;
}
