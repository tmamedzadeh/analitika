import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsSourceCard } from "./AnalyticsSourceCard";
import {
  analyticsFragmentAnchor,
  analyticsFragmentId,
  groupAnalyticsSources,
  type AnalyticsSourcePreview,
} from "@/lib/analytics";
import { az } from "@/lib/i18n/az";

function source(
  overrides: Partial<AnalyticsSourcePreview> & { n: number },
): AnalyticsSourcePreview {
  const isBrief = overrides.sourceKind === "brief";
  return {
    sourceKind: "document",
    chunkId: `chunk-${overrides.n}`,
    documentId: "document-a",
    briefId: null,
    title: "İranın Hörmüz boğazı üzərində təzyiq imkanları",
    docDate: "2026-10-21",
    briefDate: null,
    direction: "OSINT",
    sectionTitle: `Bölmə ${overrides.n}`,
    quote: `Fraqment mətni ${overrides.n}`,
    isTable: false,
    attachmentCount: 0,
    sourceReliability: "B",
    infoCredibility: 3,
    classification: "open",
    ...(isBrief
      ? {
          sourceKind: "brief" as const,
          documentId: null,
          briefId: "brief-b",
          docDate: null,
          briefDate: "2026-10-20",
          direction: null,
          sourceReliability: null,
          infoCredibility: null,
        }
      : {}),
    ...overrides,
  };
}

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
  vi.restoreAllMocks();
});

function renderGroup(
  sources: AnalyticsSourcePreview[],
  cited?: Set<number>,
  navigationScope?: string,
) {
  const [group] = groupAnalyticsSources(sources, cited);
  return render(
    <AnalyticsSourceCard
      group={group!}
      fragmentLabel={az.analytics.citedFragmentsCount.replace(
        "{count}",
        String(group!.displayedChunkCount),
      )}
      openLabel={sources.length === 1 && sources[0]!.sourceKind === "brief" ? "brief" : "document"}
      navigationScope={navigationScope}
    />,
  );
}

describe("grouped analytics source card", () => {
  it.each([1, 120])("keeps a distinct section heading of %i characters", (length) => {
    const sectionTitle = "A".repeat(length);
    renderGroup([source({ n: 1, sectionTitle })]);
    expect(screen.getByText(sectionTitle, { selector: "span" })).toBeVisible();
    expect(screen.getByText("«Fraqment mətni 1»")).toBeVisible();
  });

  it("hides a section heading longer than 120 characters without hiding its quote", () => {
    const sectionTitle = "A".repeat(121);
    renderGroup([source({ n: 1, sectionTitle })]);
    expect(screen.queryByText(sectionTitle)).toBeNull();
    expect(screen.getByText("«Fraqment mətni 1»")).toBeVisible();
  });

  it("hides a multiline body used as a heading and shows its quote only once", () => {
    const sectionTitle = `Qısa qiymətləndirmə\n\n${"Analitik mətn. ".repeat(50)}\n\n## Faktoloji baza`;
    const quote = sectionTitle.slice(0, 360);
    const { container } = renderGroup([source({ n: 1, sectionTitle, quote })]);
    const fragment = container.querySelector("li")!;
    expect(fragment.querySelectorAll("span")).toHaveLength(1);
    expect(within(fragment).getByText("[1]")).toBeVisible();
    expect(fragment.querySelector("p")?.textContent).toBe(`«${quote.slice(0, 299).trimEnd()}…»`);
    expect(fragment.querySelectorAll("p")).toHaveLength(1);
  });

  it.each(["", "   ", "… — !!!"])(
    "omits an empty or punctuation-only heading: %j",
    (sectionTitle) => {
      const { container } = renderGroup([source({ n: 1, sectionTitle })]);
      const fragment = container.querySelector("li")!;
      expect(fragment.querySelectorAll("span")).toHaveLength(1);
      expect(within(fragment).getByText("[1]")).toBeVisible();
      expect(within(fragment).getByText("«Fraqment mətni 1»")).toBeVisible();
    },
  );

  it.each([
    ["Production increased in the third quarter", "Production increased in the third quarter"],
    ["  PRODUCTION:   increased!  ", "Production increased."],
    [
      "Production increased in the third quarter",
      "Production increased in the third quarter of 2026.",
    ],
    [
      "Production increased in the third quarter of 2026.",
      "Production increased in the third quarter",
    ],
  ])("hides a heading that duplicates its quote: %j", (sectionTitle, quote) => {
    renderGroup([source({ n: 1, sectionTitle, quote })]);
    expect(screen.queryByText(sectionTitle.trim(), { selector: "span" })).toBeNull();
    expect(screen.getByText(`«${quote}»`)).toBeVisible();
  });

  it("keeps a meaningful short heading that occurs inside a longer quote", () => {
    const sectionTitle = "Production";
    const quote = "Production increased in the third quarter as demand for exports recovered.";
    renderGroup([source({ n: 1, sectionTitle, quote })]);
    expect(screen.getByText(sectionTitle, { selector: "span" })).toBeVisible();
    expect(screen.getByText(`«${quote}»`)).toBeVisible();
  });

  it("compares headings against the full quote rather than its truncated preview", () => {
    const sectionTitle = "Production";
    const quote = " ".repeat(289) + sectionTitle + " increased in the third quarter.";
    renderGroup([source({ n: 1, sectionTitle, quote })]);
    expect(screen.getByText(sectionTitle, { selector: "span" })).toBeVisible();
  });

  it.each([299, 300, 301, 1000])(
    "caps a quote of %i characters at 300 including the ellipsis",
    (length) => {
      const quote = "Q".repeat(length);
      renderGroup([source({ n: 1, quote })]);
      const preview = length > 300 ? `${quote.slice(0, 299)}…` : quote;
      expect(screen.getByText(`«${preview}»`)).toBeVisible();
      if (length > 300) expect(screen.queryByText(`«${quote}»`)).toBeNull();
    },
  );

  it("keeps grouping, citation numbers and exact chunk navigation when headings are hidden", async () => {
    const sectionTitle = "Long heading ".repeat(20);
    renderGroup([
      source({ n: 1, sectionTitle, quote: "Q".repeat(500) }),
      source({ n: 3, sectionTitle: "Duplicate quote", quote: "Duplicate quote" }),
    ]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText(sectionTitle.trim())).toBeNull();
    expect(screen.getByRole("link", { name: az.analytics.openDocument })).toHaveAttribute(
      "href",
      "/senedler/document-a?chunk=chunk-1",
    );
    const jump = screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", "3") });
    expect(jump).toHaveTextContent("[3]");
    fireEvent.click(jump);
    const fragment = document.getElementById(analyticsFragmentId("document:document-a", 3))!;
    await waitFor(() => expect(fragment).toHaveFocus());
    expect(within(fragment).getByText("[3]")).toBeVisible();
    expect(within(fragment).getByText("«Duplicate quote»")).toBeVisible();
    expect(within(fragment).queryByText("Duplicate quote", { selector: "span" })).toBeNull();
    expect(within(fragment).getByRole("link", { name: az.analytics.openFragment })).toHaveAttribute(
      "href",
      "/senedler/document-a?chunk=chunk-3",
    );
  });

  it.each(["brief", "document"] as const)(
    "opens a %s with one icon beside its heading and no duplicate destination",
    (sourceKind) => {
      renderGroup([source({ n: 1, sourceKind })]);
      const label = sourceKind === "brief" ? az.analytics.openBrief : az.analytics.openDocument;
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveTextContent("");
      expect(link.querySelector("svg")).toBeInTheDocument();
      expect(link).toHaveClass("size-10", "focus-visible:ring-2");
      expect(link.parentElement).toContainElement(screen.getByRole("heading", { level: 3 }));
      const destinations = [
        ...document.querySelectorAll('a[href^="/brifler/"], a[href^="/senedler/"]'),
      ];
      expect(destinations).toHaveLength(1);
      expect(link).toHaveAttribute("target", "_blank");
    },
  );

  it("retains distinct chunk links in expanded groups without duplicating the header destination", () => {
    renderGroup([source({ n: 1 }), source({ n: 3 })]);
    fireEvent.click(screen.getByRole("button", { name: az.analytics.toggleFragments }));
    const links = [...document.querySelectorAll('a[href^="/senedler/"]')];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/senedler/document-a?chunk=chunk-1",
      "/senedler/document-a?chunk=chunk-3",
    ]);
  });

  it("supports legacy material links without a chunk", () => {
    renderGroup([source({ n: 1, sourceKind: "brief", chunkId: "" })]);
    expect(screen.getByRole("link", { name: az.analytics.openBrief })).toHaveAttribute(
      "href",
      "/brifler/brief-b",
    );
  });
  it("shows one card for three chunks of one material with stable numbers", () => {
    renderGroup([source({ n: 1 }), source({ n: 3 }), source({ n: 6 })]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "İranın Hörmüz boğazı üzərində təzyiq imkanları" }),
    ).toBeInTheDocument();
    expect(screen.getByText(az.analytics.materialDocument)).toBeInTheDocument();
    expect(screen.getByText("2026-10-21")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(az.analytics.citedFragmentsCount.replace("{count}", "3"))),
    ).toBeVisible();
    for (const n of [1, 3, 6]) {
      const anchor = document.getElementById(`fragment-document:document-a-${n}`);
      expect(anchor).toBeInTheDocument();
      expect(within(anchor!).getByText(`«Fraqment mətni ${n}»`)).toBeInTheDocument();
      expect(within(anchor!).getByText(`Bölmə ${n}`)).toBeInTheDocument();
    }
    // The full document opens at its own chunk-scoped route.
    expect(screen.getByRole("link", { name: az.analytics.openDocument })).toHaveAttribute(
      "href",
      "/senedler/document-a?chunk=chunk-1",
    );
  });

  it("omits document metadata repetition inside each fragment", () => {
    renderGroup([source({ n: 1 }), source({ n: 3 })]);
    // Title appears once, in the card header only.
    expect(screen.getAllByText("İranın Hörmüz boğazı üzərində təzyiq imkanları")).toHaveLength(1);
    expect(screen.getAllByText("2026-10-21")).toHaveLength(1);
  });

  it("starts compact and exposes a native button that controls its fragment list", () => {
    renderGroup([source({ n: 1 }), source({ n: 3 })]);
    const toggle = screen.getByRole("button", { name: az.analytics.toggleFragments });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeVisible();
    expect(screen.queryByText("«Fraqment mətni 3»")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText("«Fraqment mətni 3»")).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getByText("«Fraqment mətni 3»")).not.toBeVisible();
  });

  it("renders a brief without document ratings and with the brief link", () => {
    renderGroup([
      source({
        n: 2,
        sourceKind: "brief",
        documentId: null,
        briefId: "brief-b",
        briefDate: "2026-10-20",
        docDate: null,
        sourceReliability: null,
        infoCredibility: null,
      }),
    ]);
    expect(screen.getByText(az.analytics.materialBrief, { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(az.reliability.sourceBadge))).toBeNull();
    expect(screen.getByRole("link", { name: az.analytics.openBrief })).toHaveAttribute(
      "href",
      "/brifler/brief-b?chunk=chunk-2",
    );
    expect(screen.getByText(az.analytics.materialBrief, { selector: "span" })).toBeInTheDocument();
  });

  it("renders an unavailable history material without exposing stale text", () => {
    renderGroup([
      source({
        n: 4,
        documentId: null,
        briefId: null,
        title: az.analytics.sourceUnavailable,
        sectionTitle: "",
        quote: "",
        direction: null,
        docDate: null,
        sourceReliability: null,
        infoCredibility: null,
      }),
    ]);
    expect(screen.getByText(az.analytics.sourceUnavailable)).toBeInTheDocument();
    // Only the inert citation-number anchors remain; no navigation is offered.
    expect(screen.queryByRole("link", { name: az.analytics.openDocument })).toBeNull();
    expect(screen.queryByRole("link", { name: az.analytics.openFragment })).toBeNull();
    expect(screen.queryByText(/Fraqment mətni/)).toBeNull();
  });

  it("preserves available source ratings when the other rating is missing", () => {
    renderGroup([source({ n: 1, infoCredibility: null })]);
    expect(
      screen.getByLabelText(`${az.reliability.sourceBadge} B: ${az.reliability.source.B}`),
    ).toBeVisible();
    expect(screen.queryByText(az.analytics.unrated)).toBeNull();
  });

  it("expands, scrolls and focuses the exact chunk, including a repeated same-hash jump", async () => {
    const scrollIntoView = vi.fn();
    const sources = [source({ n: 1 }), source({ n: 3 }), source({ n: 6 })];
    renderGroup(sources, undefined, "history-a");
    const fragment = document.getElementById(
      analyticsFragmentId("document:document-a", 3, "history-a"),
    )!;
    fragment.scrollIntoView = scrollIntoView;
    const jump = screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", "3") });
    fireEvent.click(jump);
    await waitFor(() => expect(fragment).toHaveFocus());
    expect(fragment).toHaveTextContent("Fraqment mətni 3");
    expect(fragment).toBeVisible();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.toggleFragments }));
    expect(fragment).not.toBeVisible();
    fireEvent.click(jump);
    await waitFor(() => expect(fragment).toBeVisible());
    await waitFor(() => expect(fragment).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("keeps alias anchors usable without repeating one chunk's content", async () => {
    renderGroup([source({ n: 1, chunkId: "same" }), source({ n: 3, chunkId: "same" })]);
    expect(screen.getAllByText("«Fraqment mətni 1»")).toHaveLength(1);
    expect(screen.queryByText("«Fraqment mətni 3»")).toBeNull();
    fireEvent.click(
      screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", "3") }),
    );
    await waitFor(() =>
      expect(document.getElementById(analyticsFragmentId("document:document-a", 3))).toHaveFocus(),
    );
  });

  it("resolves encoded initial deep links and ignores malformed hashes safely", async () => {
    const groupKey = "document:document% /a";
    window.history.replaceState(null, "", analyticsFragmentAnchor(groupKey, 3, "history"));
    const { unmount } = renderGroup(
      [source({ n: 1, documentId: "document% /a" }), source({ n: 3, documentId: "document% /a" })],
      undefined,
      "history",
    );
    const fragment = document.getElementById(analyticsFragmentId(groupKey, 3, "history"))!;
    await waitFor(() => expect(fragment).toHaveFocus());
    expect(fragment).toBeVisible();
    unmount();
    window.history.replaceState(null, "", "#fragment-%E0%A4%A");
    expect(() => renderGroup([source({ n: 1 }), source({ n: 3 })])).not.toThrow();
  });

  it("uses unique DOM IDs for two history cards containing the same chunks", () => {
    const [group] = groupAnalyticsSources([source({ n: 1 }), source({ n: 3 })]);
    const { container } = render(
      <>
        <AnalyticsSourceCard
          group={group!}
          fragmentLabel="2 fraqment"
          openLabel="document"
          navigationScope="history-a"
        />
        <AnalyticsSourceCard
          group={group!}
          fragmentLabel="2 fraqment"
          openLabel="document"
          navigationScope="history-b"
        />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
