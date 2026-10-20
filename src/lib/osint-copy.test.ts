import { describe, expect, it, vi } from "vitest";

import {
  buildReportHtml,
  buildReportMarkdown,
  writeReportToClipboard,
  type CopyReportInput,
} from "./osint-copy";

const input: CopyReportInput = {
  query: "Sorğu <b>test</b>",
  periodLabel: "Son 7 gün",
  languageLabels: ["Azərbaycan", "English"],
  generatedAt: "01.06.2026",
  report: {
    bluf: "Əsas nəticə <script>alert(1)</script> budur.",
    blufSourceNumbers: [3, 99],
    keyFindings: [{ text: "Birinci iddia", sourceNumbers: [3] }],
    timeline: [{ date: "2026-05-01", event: "Hadisə", sourceNumbers: [7] }],
    perspectives: [{ group: "Rəsmi", summary: "Mövqe", sourceNumbers: [3] }],
    disagreements: [],
    gaps: [],
    watch: [],
  },
  sources: [
    {
      n: 3,
      title: "Üçüncü",
      domain: "example.org",
      url: "https://example.org/a?x=1&y=2",
      publishedAt: "2026-04-02T00:00:00Z",
    },
    {
      n: 5,
      title: "Çağırılmayan",
      domain: "unused.example",
      url: "https://unused.example/",
      publishedAt: null,
    },
    {
      n: 7,
      title: "Yeddinci",
      domain: "seven.example",
      url: "javascript:alert(1)",
      publishedAt: null,
    },
  ],
};

describe("report copy builders", () => {
  it("lists only cited sources with their original numbering and external URLs", () => {
    const markdown = buildReportMarkdown(input);
    expect(markdown).toContain(
      "[3] Üçüncü — example.org, 02.04.2026, https://example.org/a?x=1&y=2",
    );
    expect(markdown).toContain("[7] Yeddinci — seven.example");
    expect(markdown).not.toContain("unused.example");
    expect(markdown).not.toContain("javascript:");
  });

  it("drops citation numbers that do not match a known source", () => {
    const markdown = buildReportMarkdown(input);
    expect(markdown).not.toContain("[99]");
    expect(markdown).toContain("[3]");
  });

  it("contains the main sections and no diagnostics or internal data", () => {
    const markdown = buildReportMarkdown(input);
    for (const heading of ["Qısa nəticə", "Əsas nəticələr", "Xronologiya", "Mənbələr"]) {
      expect(markdown).toContain("## " + heading);
    }
    expect(markdown).not.toMatch(/Texniki detallar|prompt|token|localhost|supabase/i);
  });

  it("escapes HTML in every text field and quotes in attributes", () => {
    const html = buildReportHtml(input);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>test</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://example.org/a?x=1&amp;y=2"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("unused.example");
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("writeReportToClipboard", () => {
  const report = { markdown: "# md", html: "<p>html</p>" };

  it("writes text/plain and text/html through ClipboardItem", async () => {
    const itemConstructor = vi.fn(function (this: unknown, items: Record<string, Blob>) {
      return { items };
    });
    const write = vi.fn(async () => {});
    const ok = await writeReportToClipboard(report, {
      clipboard: { write, writeText: vi.fn() },
      itemConstructor: itemConstructor as never,
    });
    expect(ok).toBe(true);
    const items = (itemConstructor.mock.calls[0] as unknown as [Record<string, Blob>])[0];
    expect(Object.keys(items).sort()).toEqual(["text/html", "text/plain"]);
    expect(await readBlob(items["text/plain"]!)).toBe("# md");
    expect(items["text/plain"]!.type).toBe("text/plain");
    expect(await readBlob(items["text/html"]!)).toBe("<p>html</p>");
    expect(items["text/html"]!.type).toBe("text/html");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("falls back to writeText when rich copy is rejected", async () => {
    const writeText = vi.fn(async () => {});
    const ok = await writeReportToClipboard(report, {
      clipboard: {
        write: async () => {
          throw new Error("denied");
        },
        writeText,
      },
      itemConstructor: function () {
        return {};
      } as never,
    });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("# md");
  });

  it("falls back to writeText when ClipboardItem is unavailable", async () => {
    const writeText = vi.fn(async () => {});
    expect(await writeReportToClipboard(report, { clipboard: { writeText } })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("# md");
  });

  it("reports failure when no clipboard path works", async () => {
    expect(await writeReportToClipboard(report, { clipboard: {} })).toBe(false);
    expect(
      await writeReportToClipboard(report, {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      }),
    ).toBe(false);
  });
});
