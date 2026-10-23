import { describe, expect, it } from "vitest";
import {
  emptyRichDocument,
  plainTextDocument,
  projectRichText,
  richDocumentSchema,
  safeRichHref,
  validateRichDocument,
  type RichDocument,
  type RichNode,
} from "./rich-text";
import { briefInputSchema } from "./briefs";
import { createDocumentSchema } from "./documents.functions";
import { chunkRichDocument } from "@/server/ingest/chunker";

export const structuredDocument: RichDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Bölmə Əİ 🌍" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Mətn ", marks: [{ type: "bold" }] },
        { type: "text", text: "e\u0301", marks: [{ type: "italic" }, { type: "underline" }] },
        { type: "hardBreak" },
        { type: "text", text: "İkinci sətir" },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Birinci" }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Alt bənd" }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Sitat",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    },
  ],
};

describe("bounded canonical rich document", () => {
  it("round-trips supported semantic structure and strips link presentation attrs", () => {
    expect(validateRichDocument(JSON.parse(JSON.stringify(structuredDocument)))).toEqual(
      structuredDocument,
    );
    const withLink = plainTextDocument("keçid");
    withLink.content[0]!.content![0]!.marks = [
      {
        type: "link",
        attrs: { href: "https://example.com", target: "_self", rel: "unsafe" },
      } as never,
    ];
    expect(validateRichDocument(withLink).content[0]!.content![0]!.marks).toEqual([
      { type: "link", attrs: { href: "https://example.com" } },
    ]);
  });
  it.each([emptyRichDocument(), plainTextDocument(" \n\t"), plainTextDocument("\u200b\ufeff")])(
    "rejects empty formatting",
    (doc) => {
      expect(richDocumentSchema().safeParse(doc).success).toBe(false);
      expect(
        briefInputSchema.safeParse({ date: "2026-10-01", bodyRich: doc, status: "published" })
          .success,
      ).toBe(false);
    },
  );
  it.each([
    { type: "doc", content: [{ type: "image", attrs: { src: "https://evil.test" } }] },
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)" },
          content: [{ type: "text", text: "test" }],
        },
      ],
    },
    {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "test" }] },
      ],
    },
    { type: "doc", content: [{ type: "text", text: "invalid parent" }] },
    { type: "doc", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "doc", content: [{ type: "bulletList", content: [{ type: "paragraph" }] }] },
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "test",
              marks: [{ type: "style", attrs: { style: "color:red" } }],
            },
          ],
        },
      ],
    },
    { type: "doc", content: [{ type: "orderedList", attrs: { start: -1 }, content: [] }] },
  ])("rejects unsupported nodes, marks, attributes and grammar", (doc) =>
    expect(() => validateRichDocument(doc)).toThrow(),
  );
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "//evil.test",
    "https://a.test/\u0000",
    "java\nscript:alert(1)",
  ])("rejects unsafe href %s", (href) => {
    expect(safeRichHref(href)).toBeNull();
    const doc = plainTextDocument("test");
    doc.content[0]!.content![0]!.marks = [{ type: "link", attrs: { href } }];
    expect(() => validateRichDocument(doc)).toThrow();
  });
  it("bounds depth, node count, serialized size and plain-text length", () => {
    let node: RichNode = { type: "paragraph", content: [{ type: "text", text: "test" }] };
    for (let i = 0; i < 26; i++) node = { type: "blockquote", content: [node] };
    expect(() => validateRichDocument({ type: "doc", content: [node] })).toThrow();
    expect(() =>
      validateRichDocument({ type: "doc", content: Array(50_001).fill({ type: "paragraph" }) }),
    ).toThrow();
    expect(() => validateRichDocument(plainTextDocument("x".repeat(500_001)))).toThrow();
    expect(() => validateRichDocument(plainTextDocument("x".repeat(201)), 200)).toThrow();
    const linked: RichNode = {
      type: "text",
      text: "x",
      marks: [{ type: "link", attrs: { href: `https://example.com/${"a".repeat(1950)}` } }],
    };
    expect(() =>
      validateRichDocument({
        type: "doc",
        content: [{ type: "paragraph", content: Array(2200).fill(linked) }],
      }),
    ).toThrow();
  });
  it("accepts documents near the text limit", () =>
    expect(validateRichDocument(plainTextDocument("ə".repeat(499_000)))).toBeTruthy());
  it("does not accept client-supplied plain text as canonical content", () => {
    expect(
      briefInputSchema.safeParse({
        date: "2026-10-01",
        title: "Override",
        body: "Untrusted",
        status: "published",
      }).success,
    ).toBe(false);
    const input = briefInputSchema.parse({
      date: "2026-10-01",
      title: "Override",
      body: "Untrusted",
      bodyRich: structuredDocument,
      status: "published",
    });
    expect(input).not.toHaveProperty("body");
    expect(input).not.toHaveProperty("title");
    const doc = createDocumentSchema.parse({
      title: "Document",
      body: "Override",
      bodyRich: structuredDocument,
      direction: "OSINT",
      classification: "open",
      sourceReliability: "A",
      infoCredibility: 1,
      photos: [],
    });
    expect(doc).not.toHaveProperty("body");
  });
});

describe("plain-text projection and indexed offsets", () => {
  it("never cuts an unbroken emoji sequence inside a surrogate pair", () => {
    const doc = plainTextDocument("x" + "🌍".repeat(1000));
    const text = projectRichText(doc).text;
    for (const chunk of chunkRichDocument(doc, "Mənbə", { targetChars: 128 })) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  });
  it("preserves block boundaries, hard breaks and UTF-16 positions without formatting noise", () => {
    const projection = projectRichText(structuredDocument);
    expect(projection.text).toBe(
      "Bölmə Əİ 🌍\n\nMətn e\u0301\nİkinci sətir\n\nBirinci\n\nAlt bənd\n\nSitat",
    );
    for (const block of projection.blocks)
      expect(projection.text.slice(block.start, block.end)).toBe(block.text);
    const span = projection.spans.get("0.1.1")!;
    expect(projection.text.slice(span.start, span.end)).toBe("e\u0301");
  });
  it("uses rich headings for chunk sections, including a heading with no following body", () => {
    const doc: RichDocument = {
      type: "doc",
      content: [
        ...structuredDocument.content,
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Son bölmə" }] },
      ],
    };
    const text = projectRichText(doc).text;
    const chunks = chunkRichDocument(doc, "Mənbə", { targetChars: 128 });
    expect(chunks[0]?.sectionTitle).toBe("Bölmə Əİ 🌍");
    expect(chunks.at(-1)?.sectionTitle).toBe("Son bölmə");
    for (const chunk of chunks) expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
  });
  it("covers a large multi-section bulletin without dropping text or misidentifying literal Markdown", () => {
    const doc: RichDocument = {
      type: "doc",
      content: Array.from({ length: 80 }, (_, index): RichNode[] => [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: `Bölmə ${index}` }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "# literal ** punctuation ** " + "əlaqə 🌍 ".repeat(200) },
          ],
        },
        {
          type: "bulletList",
          content: Array.from({ length: 5 }, (_, i): RichNode => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: `Bənd ${i}` }] }],
          })),
        },
      ]).flat(),
    };
    const text = projectRichText(doc).text;
    const chunks = chunkRichDocument(doc, "Bülleten");
    const covered = new Uint8Array(text.length);
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
      covered.fill(1, chunk.charStart, chunk.charEnd);
      expect(chunk.sectionTitle).toMatch(/^Bölmə/);
    }
    expect([...text].length).toBeGreaterThan(100_000);
    for (let i = 0; i < text.length; i++) if (!/\s/u.test(text[i]!)) expect(covered[i]).toBe(1);
  });
});
