import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { RichTextEditor } from "./RichTextEditor";
import { plainTextDocument, projectRichText, validateRichDocument } from "@/lib/rich-text";

function Harness() {
  const [doc, setDoc] = useState(plainTextDocument("Mətn üçün sınaq"));
  return (
    <>
      <RichTextEditor value={doc} onChange={setDoc} />
      <output data-testid="json">{JSON.stringify(doc)}</output>
    </>
  );
}
async function setup() {
  const result = render(<Harness />);
  const textbox = await screen.findByRole("textbox", { name: "Mətn" });
  const editor = (textbox as HTMLElement & { editor: Editor }).editor;
  return { ...result, textbox, editor };
}
describe("professional visual editor", () => {
  it("keeps selection while applying toolbar marks, reflects active state and round-trips undo/redo", async () => {
    const { editor, textbox } = await setup();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Qalın (Ctrl+B)" }));
    expect(textbox.querySelector("strong")?.textContent).toBe("Mətn");
    expect(screen.getByRole("button", { name: "Qalın (Ctrl+B)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Kursiv (Ctrl+I)" }));
    fireEvent.click(screen.getByRole("button", { name: "Altıxətli (Ctrl+U)" }));
    expect(textbox.querySelector("strong em u")?.textContent).toBe("Mətn");
    fireEvent.click(screen.getByRole("button", { name: "Geri al (Ctrl+Z)" }));
    expect(textbox.querySelector("u")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Təkrar et (Ctrl+Shift+Z)" }));
    expect(textbox.querySelector("u")).toBeTruthy();
    const parsed = validateRichDocument(JSON.parse(screen.getByTestId("json").textContent!));
    expect(projectRichText(parsed).text).toBe("Mətn üçün sınaq");
  });
  it("applies headings, lists, paragraphs and quotes without showing formatting markers", async () => {
    const { editor, textbox } = await setup();
    act(() => {
      editor.commands.setTextSelection(2);
    });
    for (const level of [1, 2, 3]) {
      fireEvent.click(screen.getByRole("button", { name: `Başlıq ${level}` }));
      expect(textbox.querySelector(`h${level}`)?.textContent).toBe("Mətn üçün sınaq");
      expect(screen.getByRole("button", { name: `Başlıq ${level}` })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Abzas" }));
    fireEvent.click(screen.getByRole("button", { name: "Markerlənmiş siyahı" }));
    expect(textbox.querySelector("ul li p")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nömrələnmiş siyahı" }));
    expect(textbox.querySelector("ol li p")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nömrələnmiş siyahı" }));
    fireEvent.click(screen.getByRole("button", { name: "Sitat" }));
    expect(textbox.querySelector("blockquote")).toBeTruthy();
    expect(textbox.textContent).toBe("Mətn üçün sınaq");
    expect(() => validateRichDocument(editor.getJSON())).not.toThrow();
  });
  it("supports keyboard formatting and safe link editing with retained text selection", async () => {
    const { editor, textbox } = await setup();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    fireEvent.keyDown(textbox, { key: "b", code: "KeyB", ctrlKey: true });
    expect(textbox.querySelector("strong")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keçid əlavə et" }));
    fireEvent.change(screen.getByLabelText("Keçidin ünvanı"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tətbiq et" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(textbox.querySelector("a")).toBeNull();
    fireEvent.change(screen.getByLabelText("Keçidin ünvanı"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tətbiq et" }));
    expect(textbox.querySelector("a")?.textContent).toBe("Mətn");
    expect(() => validateRichDocument(editor.getJSON())).not.toThrow();
  });
  it("shows Azerbaijani length errors and freezes editing during saving", async () => {
    const doc = plainTextDocument("Uzun mətn");
    render(<RichTextEditor value={doc} onChange={() => {}} maxLength={3} disabled />);
    const textbox = await screen.findByRole("textbox");
    expect(textbox).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("Mətn icazə verilən həddi keçir.");
    expect(screen.getByRole("button", { name: "Qalın (Ctrl+B)" })).toBeDisabled();
    await waitFor(() => expect(textbox.textContent).toBe("Uzun mətn"));
  });
});
