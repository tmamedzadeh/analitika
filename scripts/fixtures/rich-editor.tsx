import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RichTextEditor } from "../../src/components/RichTextEditor";
import { RichTextContent } from "../../src/components/RichTextContent";
import { BriefCard } from "../../src/components/BriefCard";
import { BRIEF_SYSTEM_TITLE, briefExcerpt } from "../../src/lib/briefs";
import { projectRichText, validateRichDocument, type RichDocument } from "../../src/lib/rich-text";
import "../../src/styles.css";

const initial: RichDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Günün icmalı" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Mühüm məlumatlar", marks: [{ type: "bold" }] },
        { type: "text", text: " və əsas istiqamətlər üzrə ümumi baxış." },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Əsas məqamlar" }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Birinci istiqamət üzrə sintetik məlumat." }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "İkinci istiqamət üzrə sintetik məlumat." }],
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
          content: [{ type: "text", text: "Qısa qiymətləndirmə və müşahidələr." }],
        },
      ],
    },
  ],
};
export function Preview() {
  const [doc, setDoc] = useState(initial);
  const [saved, setSaved] = useState<RichDocument | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const text = projectRichText(doc).text;
  return (
    <main style={{ maxWidth: 1160, margin: "auto", padding: 20 }}>
      <p className="label-mono">ZİRVƏ · Bülletenlər</p>
      <h1 style={{ fontSize: 28, fontWeight: 650, margin: "8px 0 20px" }}>Yeni bülleten</h1>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: 24,
        }}
      >
        <section>
          <label className="text-sm">
            Tarix
            <input type="date" className="field mt-2" defaultValue="2026-10-01" />
          </label>
          <RichTextEditor
            key={version}
            value={doc}
            onChange={setDoc}
            label="Mətn"
            maxLength={200_000}
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="pill"
              onClick={() => {
                try {
                  setSaved(validateRichDocument(doc, 200_000));
                  setError("");
                } catch {
                  setError("Mətni yoxlayın.");
                }
              }}
            >
              Yadda saxla
            </button>
            <button
              className="pill"
              disabled={!saved}
              onClick={() => {
                setDoc(JSON.parse(JSON.stringify(saved)));
                setVersion((value) => value + 1);
              }}
            >
              Yenidən aç
            </button>
          </div>
          {saved && <p role="status">Yadda saxlanıldı.</p>}
          {error && <p role="alert">{error}</p>}
        </section>
        <aside>
          <p className="label-mono mb-3">Önizləmə</p>
          <div>
            <BriefCard
              preview
              brief={{
                id: "preview",
                title: BRIEF_SYSTEM_TITLE,
                date: "2026-10-01",
                excerpt: briefExcerpt(text),
                classification: "open",
                status: "published",
                indexStatus: "none",
                indexProgress: { percent: 0, totalChunks: 0, completedChunks: 0 },
                photoCount: 0,
              }}
            />
          </div>
          {saved && (
            <section style={{ marginTop: 24 }} data-testid="saved">
              <RichTextContent document={saved} />
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
