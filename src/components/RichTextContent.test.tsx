import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichTextContent } from "./RichTextContent";
import { plainTextDocument, projectRichText, type RichDocument } from "@/lib/rich-text";

const doc: RichDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Bölmə 🌍" }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Alfa ", marks: [{ type: "bold" }] },
                { type: "text", text: "beta", marks: [{ type: "italic" }] },
                { type: "hardBreak" },
                { type: "text", text: "İkinci", marks: [{ type: "underline" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};
describe("safe rich rendering and exact citation navigation", () => {
  it("renders semantic structure and partial highlights across marks and line breaks", () => {
    const text = projectRichText(doc).text;
    const start = text.indexOf("fa");
    const end = text.indexOf("İkinci") + 2;
    const { container } = render(<RichTextContent document={doc} highlight={{ start, end }} />);
    expect(container.querySelector("h2")?.textContent).toBe("Bölmə 🌍");
    expect(container.querySelector("ul li strong")).toBeTruthy();
    expect(container.querySelector("em mark")?.textContent).toBe("beta");
    expect(container.querySelector("u mark")?.textContent).toBe("İk");
    expect(
      [...container.querySelectorAll("mark")]
        .map((mark) => (mark.querySelector("br") ? "\n" : mark.textContent))
        .join(""),
    ).toBe(text.slice(start, end));
    expect(container.querySelectorAll('[data-chunk-highlight="true"]').length).toBe(4);
  });
  it("escapes text and refuses unsafe links even if a malformed record bypasses write validation", () => {
    const unsafe = plainTextDocument('<img src=x onerror="alert(1)">');
    unsafe.content[0]!.content![0]!.marks = [
      { type: "link", attrs: { href: "javascript:alert(1)" } },
    ];
    const { container } = render(<RichTextContent document={unsafe} />);
    expect(container.querySelector("img,script,a")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
  it("ignores out-of-range offsets and supports content-only rerenders", () => {
    const { container, rerender } = render(
      <RichTextContent document={doc} highlight={{ start: 9999, end: 10000 }} />,
    );
    expect(container.querySelector("mark")).toBeNull();
    rerender(<RichTextContent document={doc} highlight={{ start: 0, end: 8 }} />);
    expect(container.querySelector("h2 mark")?.textContent).toBe("Bölmə 🌍");
  });
});
