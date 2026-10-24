import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes, Root, PhrasingContent } from "mdast";
import type { AnalyticsCitationSource } from "@/components/AnalyticsCitation";
import { analyticsSourceGroupKey } from "./analytics";

const parser = unified().use(remarkParse).use(remarkGfm);

/** One recognizer for the frontend source list and the Markdown renderer. */
function citationNodes(tree: Root, markdown: string, onCitation: (n: number) => void): void {
  function visit(node: Nodes): void {
    // Numeric-labelled links were already treated as citations. Ignore their
    // model-authored URL; never descend into ordinary links, images or code.
    if (node.type === "link") {
      const child = node.children.length === 1 ? node.children[0] : undefined;
      if (child?.type === "text" && /^[1-9]\d*$/u.test(child.value)) {
        const n = Number(child.value);
        if (Number.isSafeInteger(n)) {
          onCitation(n);
          node.url = `#citation-${n}`;
          node.data = { ...node.data, hProperties: { "data-analytics-citation": true } };
        }
      }
      return;
    }
    if (node.type === "linkReference" || node.type === "imageReference") return;
    if (!("children" in node)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;
      if (child.type !== "text") {
        visit(child);
        continue;
      }
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      // Escapes/entities can change text offsets. Leave ambiguous text alone.
      if (start === undefined || end === undefined || markdown.slice(start, end) !== child.value)
        continue;
      const parts: PhrasingContent[] = [];
      let offset = 0;
      for (const match of child.value.matchAll(/\[([1-9]\d*)\]/gu)) {
        const n = Number(match[1]);
        if (!Number.isSafeInteger(n)) continue;
        if (match.index > offset)
          parts.push({ type: "text", value: child.value.slice(offset, match.index) });
        parts.push({
          type: "link",
          url: `#citation-${n}`,
          children: [{ type: "text", value: String(n) }],
          data: { hProperties: { "data-analytics-citation": true } },
        });
        onCitation(n);
        offset = match.index + match[0].length;
      }
      if (!parts.length) continue;
      if (offset < child.value.length)
        parts.push({ type: "text", value: child.value.slice(offset) });
      // Only phrasing parents can contain the text node being replaced.
      (node.children as PhrasingContent[]).splice(i, 1, ...parts);
      i += parts.length - 1;
    }
  }
  visit(tree);
}

export function analyticsCitedNumbers(markdown: string): Set<number> {
  const numbers = new Set<number>();
  citationNodes(parser.parse(markdown), markdown, (n) => numbers.add(n));
  return numbers;
}

export function remarkAnalyticsCitations() {
  return (tree: Root, file: { toString(): string }) => {
    citationNodes(tree, String(file), () => {});
  };
}

/** Original identities and input order stay intact; this map is presentation only. */
export function analyticsCitationDisplayNumbers(
  sources: readonly AnalyticsCitationSource[],
  cited: ReadonlySet<number>,
): ReadonlyMap<number, number> {
  const mapping = new Map<number, number>();
  const identities = new Map<string, number>();
  const seen = new Set<number>();
  for (const source of sources) {
    if (!cited.has(source.n)) continue;
    if (seen.has(source.n) || !Number.isSafeInteger(source.n) || source.n < 1) return new Map();
    seen.add(source.n);
    if (source.available === false) continue;
    if (source.preview && source.preview.n !== source.n) return new Map();
    const identity = { ...source, ...source.preview, n: source.n };
    if (!identity.chunkId && !identity.documentId && !identity.briefId) return new Map();
    const key = JSON.stringify([analyticsSourceGroupKey(identity), identity.chunkId || null]);
    const existing = identities.get(key);
    // Multiple legacy parent-only records cannot identify individual fragments.
    if (existing !== undefined && !identity.chunkId) return new Map();
    const displayN = existing ?? identities.size + 1;
    identities.set(key, displayN);
    mapping.set(source.n, displayN);
  }
  // An inert, unavailable [2] must never share its label with a working [7] → [2].
  const displayed = new Set(mapping.values());
  if ([...cited].some((n) => !mapping.has(n) && displayed.has(n))) return new Map();
  return mapping;
}
