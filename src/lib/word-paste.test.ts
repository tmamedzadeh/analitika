import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { richTextExtensions } from "./rich-text-extensions";
import { cleanPastedHtml } from "./word-paste";
import { projectRichText, validateRichDocument } from "./rich-text";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function paste(html: string) {
  const editor = new Editor({
    extensions: richTextExtensions(),
    editorProps: { transformPastedHTML: cleanPastedHtml },
  });
  editors.push(editor);
  editor.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
  return { editor, doc: validateRichDocument(editor.getJSON()) };
}

describe("Word clipboard HTML through the real ProseMirror paste pipeline", () => {
  it("preserves headings, inline styles, nested lists, numbering, paragraphs and links", () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>.MsoNormal{color:red}</style></head><body>
      <p class="MsoHeading1"><span style="font-weight:700">İcmal</span></p>
      <p class="MsoNormal"><span style="font-style:italic;text-decoration:underline;color:red;font-family:Calibri">Mətn</span> <a href="https://example.com/news" onclick="alert(1)">mənbə</a><o:p></o:p></p>
      <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span>Birinci</p>
      <p class="MsoListParagraph" style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">▪ </span>Alt bənd</p>
      <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span>İkinci</p>
      <h2>Bölmə</h2><p style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">3. </span>Nömrəli</p>
      <p style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">4. </span>Davamı</p>
      <blockquote><p>Sitat</p></blockquote><h3>Son</h3></body></html>`;
    const { editor, doc } = paste(html);
    const output = editor.getHTML();
    expect(output).toContain("<h1><strong>İcmal</strong></h1>");
    expect(output).toContain("<em><u>Mətn</u></em>");
    expect(output).toContain('<ol start="3">');
    expect(output).toContain(
      "<ul><li><p>Birinci</p><ul><li><p>Alt bənd</p></li></ul></li><li><p>İkinci</p></li></ul>",
    );
    expect(output).toContain("<blockquote><p>Sitat</p></blockquote>");
    expect(output).not.toMatch(/mso-|Calibri|style=|onclick|o:p/iu);
    expect(projectRichText(doc).text).toContain("Birinci\n\nAlt bənd\n\nİkinci");
  });
  it("removes executable HTML, unsafe links, embedded objects and Word metadata", () => {
    const { editor, doc } = paste(
      `<p>Safe<script>alert(1)</script><img src="https://evil.test/pixel" onerror="alert(1)"><iframe src="https://evil.test"></iframe><object data="file:///test"></object><svg onload="alert(1)"><text>evil</text></svg><a href="javascript:alert(1)">text</a></p>`,
    );
    expect(projectRichText(doc).text).toBe("Safetext");
    expect(editor.getHTML()).toBe("<p>Safetext</p>");
  });
  it("handles standard HTML lists and literal plain-text paste without interpreting markers", () => {
    const { editor } = paste("<h2>Başlıq</h2><ol><li><p>Bir</p></li></ol>");
    expect(editor.getHTML()).toContain("<h2>Başlıq</h2>");
    editor.commands.clearContent();
    editor.view.pasteText("# literal ** mətn\nİkinci sətir", new Event("paste") as ClipboardEvent);
    const doc = validateRichDocument(editor.getJSON());
    expect(projectRichText(doc).text).toBe("# literal ** mətn\n\nİkinci sətir");
    expect(editor.getHTML()).not.toContain("<strong>");
  });
  it("supports a bulletin with the reference's 287 paragraphs and 55 list items", () => {
    const html = Array.from({ length: 287 }, (_, i) =>
      i % 5 === 0 && i < 275
        ? `<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span>Sintetik bənd ${i}</p>`
        : `<p><b>Sintetik bölmə ${i}.</b> ${"Sintetik mətn. ".repeat(15)}</p>`,
    ).join("");
    const { doc, editor } = paste(html);
    expect(projectRichText(doc).blocks).toHaveLength(287);
    const container = document.createElement("div");
    container.innerHTML = editor.getHTML();
    expect(container.querySelectorAll("li")).toHaveLength(55);
    const reopened = new Editor({
      extensions: richTextExtensions(),
      content: JSON.parse(JSON.stringify(doc)),
    });
    editors.push(reopened);
    expect(validateRichDocument(reopened.getJSON())).toEqual(doc);
  });
  it("rejects oversized or deeply nested clipboard markup", () => {
    expect(() => cleanPastedHtml("x".repeat(4_000_001))).toThrow();
    expect(() => cleanPastedHtml("<span>".repeat(30) + "text" + "</span>".repeat(30))).toThrow();
  });
});
