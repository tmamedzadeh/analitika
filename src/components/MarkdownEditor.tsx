import { Bold, Italic, List, ListOrdered, Quote } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { az } from "@/lib/i18n/az";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  name?: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
};

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  name,
  required = false,
  maxLength,
  className = "min-h-80",
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function updateValue(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.currentTarget.value);
  }

  function format(kind: "bold" | "italic" | "bullet" | "numbered" | "quote") {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;
    const selectedText = value.slice(selectionStart, selectionEnd);
    let replacement = selectedText;
    let selectionOffset = 0;
    let selectionLength = (selectedText || az.richText.placeholder).length;

    if (kind === "bold" || kind === "italic") {
      const marker = kind === "bold" ? "**" : "*";
      replacement = selectedText || az.richText.placeholder;
      replacement = `${marker}${replacement}${marker}`;
      selectionOffset = marker.length;
    } else {
      const text = selectedText || az.richText.placeholder;
      const prefix = kind === "bullet" ? "- " : kind === "numbered" ? "1. " : "> ";
      replacement = text
        .split("\n")
        .map((line, index) => `${kind === "numbered" ? `${index + 1}. ` : prefix}${line}`)
        .join("\n");
      selectionOffset = prefix.length;
      selectionLength = replacement.length - selectionOffset;
    }

    const nextValue = value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
    const nextSelectionStart = selectionStart + selectionOffset;
    const nextSelectionEnd = nextSelectionStart + selectionLength;
    onChange(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  }

  const tools = [
    { kind: "bold", label: az.richText.bold, icon: Bold },
    { kind: "italic", label: az.richText.italic, icon: Italic },
    { kind: "bullet", label: az.richText.bulletList, icon: List },
    { kind: "numbered", label: az.richText.numberedList, icon: ListOrdered },
    { kind: "quote", label: az.richText.quote, icon: Quote },
  ] as const;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">
      <div
        role="toolbar"
        aria-label={az.richText.toolbar}
        className="flex flex-wrap gap-1 border-b border-border bg-muted/30 p-2"
      >
        {tools.map(({ kind, label, icon: Icon }) => (
          <Button
            key={kind}
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={label}
            title={label}
            onClick={() => format(kind)}
          >
            <Icon aria-hidden="true" />
          </Button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        name={name}
        required={required}
        maxLength={maxLength}
        className={`field resize-y rounded-none border-0 shadow-none focus-visible:ring-0 ${className}`}
        placeholder={placeholder}
        value={value}
        onChange={updateValue}
      />
    </div>
  );
}
