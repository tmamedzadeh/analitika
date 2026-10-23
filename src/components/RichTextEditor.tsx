import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { richTextExtensions } from "@/lib/rich-text-extensions";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Link2,
  Unlink,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  emptyRichDocument,
  projectRichText,
  safeRichHref,
  type RichDocument,
} from "@/lib/rich-text";
import { cleanPastedHtml } from "@/lib/word-paste";

function Toolbar({
  editor,
  disabled,
  onLink,
}: {
  editor: Editor;
  disabled: boolean;
  onLink: () => void;
}) {
  useEditorState({
    editor,
    selector: ({ editor }) => ({
      marks: [
        "bold",
        "italic",
        "underline",
        "heading",
        "bulletList",
        "orderedList",
        "blockquote",
        "link",
      ].map((name) => editor.isActive(name)),
      selection: editor.state.selection.from + ":" + editor.state.selection.to,
      undo: editor.can().undo(),
      redo: editor.can().redo(),
    }),
  });
  const tools = [
    {
      label: "Qalın (Ctrl+B)",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Kursiv (Ctrl+I)",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Altıxətli (Ctrl+U)",
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      label: `Başlıq ${level}`,
      icon: [Heading1, Heading2, Heading3][level - 1]!,
      active: editor.isActive("heading", { level }),
      run: () => editor.chain().focus().toggleHeading({ level }).run(),
    })),
    {
      label: "Abzas",
      icon: Pilcrow,
      active: editor.isActive("paragraph"),
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Markerlənmiş siyahı",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Nömrələnmiş siyahı",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Sitat",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    { label: "Keçid əlavə et", icon: Link2, active: editor.isActive("link"), run: onLink },
    {
      label: "Keçidi sil",
      icon: Unlink,
      unavailable: !editor.isActive("link"),
      run: () => editor.chain().focus().unsetLink().run(),
    },
    {
      label: "Geri al (Ctrl+Z)",
      icon: Undo2,
      unavailable: !editor.can().undo(),
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Təkrar et (Ctrl+Shift+Z)",
      icon: Redo2,
      unavailable: !editor.can().redo(),
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div
      role="toolbar"
      aria-label="Mətnin formatlaşdırılması"
      className="flex flex-wrap gap-1 border-b border-border bg-secondary/40 p-2"
    >
      {tools.map(({ label, icon: Icon, active, unavailable, run }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled || unavailable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
          className={`inline-flex size-10 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
        >
          <Icon size={17} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  maxLength = 500_000,
  disabled = false,
  label = "Mətn",
  placeholder,
  className = "",
}: {
  value: RichDocument;
  onChange: (value: RichDocument) => void;
  maxLength?: number;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const editor = useEditor({
    extensions: richTextExtensions(),
    content: value,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-required": "true",
        "aria-label": label,
        "aria-placeholder": placeholder ?? "Mətni daxil edin…",
        class: "rich-document min-h-72 p-5 sm:p-7 focus:outline-none",
      },
      transformPastedHTML: (html) => {
        try {
          setError("");
          return cleanPastedHtml(html);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Mətn daxil edilmədi.");
          return "";
        }
      },
    },
    onUpdate: ({ editor }) => {
      setError("");
      onChange(editor.getJSON() as RichDocument);
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    // Parent echo must not replace the document (which would reset selection and undo).
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value))
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  const length = projectRichText(value ?? emptyRichDocument()).text.length;
  return (
    <div
      className={`mt-2 min-w-0 overflow-hidden rounded-xl border border-border bg-card focus-within:border-primary/50 ${className}`}
    >
      {editor && (
        <Toolbar
          editor={editor}
          disabled={disabled}
          onLink={() => {
            setHref(String(editor.getAttributes("link")["href"] ?? ""));
            setLinkOpen(true);
          }}
        />
      )}
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <label className="min-w-40 flex-1 text-sm">
            Keçidin ünvanı
            <input
              autoFocus
              type="url"
              className="field mt-1"
              value={href}
              placeholder="https://"
              onChange={(event) => setHref(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="pill"
            disabled={disabled}
            onClick={() => {
              const safe = safeRichHref(href.trim());
              if (!safe) {
                setError("Düzgün http, https və ya mailto keçidi daxil edin.");
                return;
              }
              editor?.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
              setError("");
              setLinkOpen(false);
            }}
          >
            Tətbiq et
          </button>
          <button type="button" className="pill" onClick={() => setLinkOpen(false)}>
            Ləğv et
          </button>
        </div>
      )}
      <div className="relative">
        <EditorContent editor={editor} />
        {length === 0 && (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute left-5 top-5 text-muted-foreground sm:left-7 sm:top-7"
          >
            {placeholder ?? "Mətni daxil edin…"}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>Word-dən formatlaşdırılmış mətn daxil edə bilərsiniz.</span>
        <span>
          {length.toLocaleString("az-AZ")} / {maxLength.toLocaleString("az-AZ")}
        </span>
      </div>
      {(error || length > maxLength) && (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          {error || "Mətn icazə verilən həddi keçir."}
        </p>
      )}
    </div>
  );
}
