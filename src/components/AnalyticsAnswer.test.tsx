import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsAnswer } from "./AnalyticsAnswer";
import { az } from "@/lib/i18n/az";
import type { AnalyticsSourcePreview } from "@/lib/analytics";

const preview: AnalyticsSourcePreview = {
  n: 8,
  sourceKind: "document",
  documentId: "trusted-document",
  briefId: null,
  chunkId: "trusted-chunk",
  title: "Synthetic budget report",
  sectionTitle: "Approved budget",
  docDate: "2026-10-21",
  briefDate: null,
  quote: "The approved budget is 12 million AZN.",
  sourceReliability: "D",
  infoCredibility: 5,
  direction: "OSINT",
  classification: "open",
  isTable: false,
  attachmentCount: 0,
};
afterEach(() => vi.unstubAllGlobals());

describe("analytics citation links", () => {
  it("attributes the actual model and omits attribution for non-generated answers", () => {
    const { rerender } = render(
      <AnalyticsAnswer answer="Nəticə [1]" sources={[{ n: 1 }]} model="gemini-3.1-flash-lite" />,
    );
    expect(screen.getByText("Gemini 3.1 Flash-Lite tərəfindən yaradılıb")).toBeInTheDocument();
    rerender(
      <AnalyticsAnswer
        answer={az.analytics.noSources}
        sources={[]}
        model="gemini-3.1-flash-lite"
      />,
    );
    expect(screen.queryByText(/tərəfindən yaradılıb/)).toBeNull();
    rerender(<AnalyticsAnswer answer="" sources={[]} />);
    expect(screen.queryByText(/tərəfindən yaradılıb/)).toBeNull();
  });
  it("links numbered citations to source cards supplied by the server", () => {
    render(
      <AnalyticsAnswer
        answer="Nəticə [1]. Müqayisə [2][3]."
        sources={[{ n: 1 }, { n: 2 }, { n: 3 }]}
      />,
    );
    for (const n of [1, 2, 3]) {
      expect(
        screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", String(n)) }),
      ).toHaveAttribute("href", `#source-${n}`);
    }
  });

  it("uses no model-authored URL as a document or citation destination", () => {
    const { container } = render(
      <AnalyticsAnswer
        answer="Nəticə [1](https://untrusted.test/senedler/secret). [Hesabat](https://untrusted.test/report) [Daxili sənəd](/senedler/secret)."
        sources={[{ n: 1 }]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "#source-1");
    expect(container.querySelector('a[href*="untrusted"]')).toBeNull();
    expect(container.querySelector('a[href*="secret"]')).toBeNull();
    expect(container).toHaveTextContent("Hesabat");
  });

  it("keeps unavailable history sources and unknown source numbers non-clickable", () => {
    render(
      <AnalyticsAnswer
        answer="Nəticə [1][2][99]."
        sources={[
          { n: 1, available: true },
          { n: 2, available: false },
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("[2]")).toBeInTheDocument();
    expect(screen.getByText("[99]")).toBeInTheDocument();
  });
});

describe("analytics answer actions and source previews", () => {
  it("copies only the complete answer with headings, paragraphs, tables and citations", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const answer =
      "## Nəticə\n\n12 milyon AZN [8].\n\n| Dövr | Məbləğ |\n| --- | --- |\n| 2026 | 12 milyon |";
    render(
      <AnalyticsAnswer
        answer={answer}
        sources={[{ n: 8, preview }]}
        model="gemini-3.1-flash-lite"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: az.analytics.copy }));
    expect(await screen.findByText(az.analytics.copied)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(answer);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: az.analytics.table })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });
  it.each([false, true])(
    "reports clipboard rejection or unavailable API (missing: %s)",
    async (missing) => {
      vi.stubGlobal(
        "navigator",
        missing ? {} : { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } },
      );
      render(<AnalyticsAnswer answer="Nəticə [8]." sources={[{ n: 8 }]} />);
      fireEvent.click(screen.getByRole("button", { name: az.analytics.copy }));
      expect(await screen.findByText(az.analytics.copyFailed)).toBeInTheDocument();
      expect(screen.queryByText(az.analytics.copied)).toBeNull();
    },
  );
  it("opens trusted metadata by focus/click and exposes full-source and source-card navigation", async () => {
    render(
      <AnalyticsAnswer
        answer="12 milyon AZN [8](https://untrusted.test)."
        sources={[{ n: 8, preview }]}
      />,
    );
    const citation = screen.getByRole("link", {
      name: az.analytics.openSource.replace("{n}", "8"),
    });
    fireEvent.focus(citation);
    expect(await screen.findByText(/2026-10-21 · Approved budget/)).toBeInTheDocument();
    expect(screen.getByText(preview.quote)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: az.analytics.openFullSource })).toHaveAttribute(
      "href",
      "/senedler/trusted-document?chunk=trusted-chunk",
    );
    expect(screen.getByRole("link", { name: az.analytics.sourceCard })).toHaveAttribute(
      "href",
      "#source-8",
    );
    fireEvent.keyDown(citation, { key: "Escape" });
    fireEvent.click(citation);
    expect(await screen.findByText(preview.quote)).toBeInTheDocument();
  });
  it("never shows a revoked source preview even when obsolete metadata was supplied", () => {
    render(
      <AnalyticsAnswer answer="Nəticə [8]." sources={[{ n: 8, available: false, preview }]} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(preview.quote)).toBeNull();
    expect(screen.queryByLabelText(az.analytics.reliabilityLimitations)).toBeNull();
  });
  it("identifies only cited low ratings and keeps unassessed F/6 neutral", () => {
    const { rerender } = render(
      <AnalyticsAnswer answer="Nəticə [8]." sources={[{ n: 8, preview }]} />,
    );
    expect(screen.getByLabelText(az.analytics.reliabilityLimitations)).toHaveTextContent("[8]");
    rerender(
      <AnalyticsAnswer
        answer="Nəticə [1]."
        sources={[
          { n: 8, preview },
          { n: 1, preview: { ...preview, n: 1, sourceReliability: "F", infoCredibility: 6 } },
        ]}
      />,
    );
    expect(screen.queryByLabelText(az.analytics.reliabilityLimitations)).toBeNull();
  });
  it("disables answer actions during a request", () => {
    const regenerate = vi.fn();
    const { rerender } = render(
      <AnalyticsAnswer answer="Nəticə." sources={[]} onRegenerate={regenerate} busy />,
    );
    expect(screen.getByRole("button", { name: az.analytics.copy })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: az.analytics.regenerate }));
    expect(regenerate).not.toHaveBeenCalled();
    rerender(<AnalyticsAnswer answer="Nəticə." sources={[]} onRegenerate={regenerate} />);
    fireEvent.click(screen.getByRole("button", { name: az.analytics.regenerate }));
    expect(regenerate).toHaveBeenCalledOnce();
  });
});
