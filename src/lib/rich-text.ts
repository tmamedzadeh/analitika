import { z } from "zod";

/** Version 1: a deliberately small, portable ProseMirror document schema. */
export type RichMark = { type: "bold" | "italic" | "underline" | "link"; attrs?: { href: string } };
export type RichNode = {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "blockquote"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "text"
    | "hardBreak";
  attrs?: { level?: number; start?: number; type?: "1" | "a" | "A" | "i" | "I" };
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
};
export type RichDocument = RichNode & { type: "doc"; content: RichNode[] };
export const MAX_RICH_BYTES = 4_000_000;
export const MAX_RICH_NODES = 50_000;
export const MAX_RICH_DEPTH = 24;
export const emptyRichDocument = (): RichDocument => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

function hasForbiddenCharacters(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return true;
    if (code === 127 || (code < 32 && !(allowLineBreaks && [9, 10, 13].includes(code))))
      return true;
  }
  return false;
}

export function safeRichHref(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /\s/u.test(value) ||
    hasForbiddenCharacters(value, false)
  )
    return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

const blockTypes = new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList"]);
const invalid = () => {
  throw new Error("Mətnin quruluşu və ya ölçüsü düzgün deyil.");
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

/** Reject unsupported content; never accept client HTML, arbitrary attrs, or a second text body. */
export function validateRichDocument(value: unknown, maxTextLength = 500_000): RichDocument {
  let count = 0;
  let textLength = 0;
  let stringBudget = 0;
  function visit(input: unknown, depth: number, parent: string): RichNode {
    if (++count > MAX_RICH_NODES || depth > MAX_RICH_DEPTH) return invalid();
    const node = record(input);
    keys(node, ["type", "attrs", "content", "text", "marks"]);
    const type = node["type"];
    if (typeof type !== "string") return invalid();
    const allowed =
      parent === "root"
        ? type === "doc"
        : parent === "paragraph" || parent === "heading"
          ? type === "text" || type === "hardBreak"
          : parent === "bulletList" || parent === "orderedList"
            ? type === "listItem"
            : blockTypes.has(type);
    if (!allowed) return invalid();
    const result: RichNode = { type: type as RichNode["type"] };
    if (type === "text") {
      if (
        typeof node["text"] !== "string" ||
        !node["text"].length ||
        hasForbiddenCharacters(node["text"], true)
      )
        return invalid();
      result.text = node["text"];
      textLength += result.text.length;
      stringBudget += result.text.length;
      if (textLength > maxTextLength) return invalid();
    } else if (node["text"] !== undefined) return invalid();
    if (node["attrs"] !== undefined) {
      const attrs = record(node["attrs"]);
      keys(attrs, type === "heading" ? ["level"] : type === "orderedList" ? ["start", "type"] : []);
      if (type === "heading") {
        if (![1, 2, 3].includes(attrs["level"] as number)) return invalid();
        result.attrs = { level: attrs["level"] as number };
      } else if (type === "orderedList") {
        const start = attrs["start"];
        if (!Number.isInteger(start) || (start as number) < 1 || (start as number) > 1_000_000)
          return invalid();
        result.attrs = { start: start as number };
        const numbering = attrs["type"];
        if (numbering != null) {
          if (!["1", "a", "A", "i", "I"].includes(numbering as string)) return invalid();
          result.attrs.type = numbering as NonNullable<RichNode["attrs"]>["type"] & string;
        }
      }
    } else if (type === "heading") return invalid();
    if (node["marks"] !== undefined) {
      if (type !== "text" && type !== "hardBreak") return invalid();
      const marks = node["marks"];
      if (!Array.isArray(marks) || marks.length > 4) return invalid();
      const seen = new Set<string>();
      result.marks = marks.map((value): RichMark => {
        const mark = record(value);
        keys(mark, ["type", "attrs"]);
        const markType = mark["type"];
        if (
          typeof markType !== "string" ||
          !["bold", "italic", "underline", "link"].includes(markType) ||
          seen.has(markType)
        )
          return invalid();
        seen.add(markType);
        if (markType === "link") {
          const attrs = record(mark["attrs"]);
          // TipTap supplies these presentation attrs; canonical JSON retains only href.
          keys(attrs, ["href", "target", "rel", "class", "title"]);
          for (const key of ["target", "rel", "class", "title"]) {
            if (
              attrs[key] != null &&
              (typeof attrs[key] !== "string" || (attrs[key] as string).length > 2048)
            )
              return invalid();
          }
          const href = safeRichHref(attrs["href"]);
          if (!href) return invalid();
          stringBudget += href.length;
          return { type: "link", attrs: { href } };
        }
        if (mark["attrs"] !== undefined && Object.keys(record(mark["attrs"])).length)
          return invalid();
        return { type: markType as RichMark["type"] };
      });
    }
    if (type === "text" || type === "hardBreak") {
      if (node["content"] !== undefined || node["attrs"] !== undefined) return invalid();
    } else {
      if (node["content"] !== undefined && !Array.isArray(node["content"])) return invalid();
      const children = (node["content"] ?? []) as unknown[];
      if (children.length > MAX_RICH_NODES) return invalid();
      result.content = children.map((child) => visit(child, depth + 1, type));
      if (!["paragraph", "heading"].includes(type) && !result.content.length) return invalid();
      if (type === "listItem" && result.content[0]?.type !== "paragraph") return invalid();
    }
    if (stringBudget > MAX_RICH_BYTES) return invalid();
    return result;
  }
  const doc = visit(value, 0, "root") as RichDocument;
  if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_RICH_BYTES) return invalid();
  const text = projectRichText(doc).text;
  if (text.length > maxTextLength || !text.replace(/[\s\u200b-\u200d\ufeff]/gu, ""))
    return invalid();
  return doc;
}

export const richDocumentSchema = (maxLength = 500_000) =>
  z.unknown().transform((value, ctx): RichDocument => {
    try {
      return validateRichDocument(value, maxLength);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mətnin quruluşu və ya ölçüsü düzgün deyil.",
      });
      return z.NEVER;
    }
  });

export type RichTextBlock = {
  path: string;
  type: "paragraph" | "heading";
  level?: number;
  start: number;
  end: number;
  text: string;
};
export type RichTextSpan = { start: number; end: number };
/** UTF-16 offsets (JS slice / existing chunk offsets). No trimming or Unicode normalization. */
export function projectRichText(doc: RichDocument): {
  text: string;
  blocks: RichTextBlock[];
  spans: Map<string, RichTextSpan>;
} {
  const blocks: RichTextBlock[] = [];
  const spans = new Map<string, RichTextSpan>();
  const parts: string[] = [];
  let offset = 0;
  function walk(node: RichNode, path: string) {
    if (node.type === "paragraph" || node.type === "heading") {
      if (blocks.length) {
        parts.push("\n\n");
        offset += 2;
      }
      const start = offset;
      const inline: string[] = [];
      node.content?.forEach((child, i) => {
        const text = child.type === "hardBreak" ? "\n" : (child.text ?? "");
        spans.set(`${path}.${i}`, { start: offset, end: offset + text.length });
        inline.push(text);
        offset += text.length;
      });
      const text = inline.join("");
      parts.push(text);
      blocks.push({
        path,
        type: node.type,
        ...(node.attrs?.level ? { level: node.attrs.level } : {}),
        start,
        end: offset,
        text,
      });
    } else node.content?.forEach((child, i) => walk(child, `${path}.${i}`));
  }
  walk(doc, "0");
  return { text: parts.join(""), blocks, spans };
}

/** For fixtures/imports of actual plain text. This does not interpret Markdown. */
export function plainTextDocument(text: string): RichDocument {
  return {
    type: "doc",
    content: text.split(/\r?\n\r?\n/u).map((paragraph) => ({
      type: "paragraph",
      content: paragraph
        .split(/\r?\n/u)
        .flatMap((line, index): RichNode[] => [
          ...(index ? [{ type: "hardBreak" } as RichNode] : []),
          ...(line ? [{ type: "text", text: line } as RichNode] : []),
        ]),
    })),
  };
}
