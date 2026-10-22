import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { getAnalyticsQueryHistory, listRecentAnalyticsQueries } from "@/lib/analytics.functions";
import { directionIds } from "@/lib/directions";
import { az } from "@/lib/i18n/az";

vi.mock("@/lib/analytics.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics.functions")>();
  return {
    ...actual,
    listRecentAnalyticsQueries: vi.fn(),
    getAnalyticsQueryHistory: vi.fn(),
  };
});

describe("analytics search layout", () => {
  it("opens available history sources by exact UUID and counts them without an empty state", async () => {
    const documentId = "00000000-0000-4000-8000-000000000001";
    const briefId = "00000000-0000-4000-8000-000000000002";
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([
      {
        id: "history",
        query: "Saved question",
        status: "done",
        createdAt: new Date().toISOString(),
        durationMs: 12,
      },
    ]);
    const snapshot = {
      title: "Available document",
      caption: "Section",
      usedInAnswer: false,
      maxClassification: "open",
      model: "test",
      durationMs: 12,
      createdAt: new Date().toISOString(),
      available: true,
    };
    vi.mocked(getAnalyticsQueryHistory).mockResolvedValue({
      id: "history",
      query: "Saved question",
      status: "done",
      answer: "Saved summary [1][2][3].",
      model: "test",
      durationMs: 12,
      createdAt: new Date().toISOString(),
      filters: {
        period: "all",
        directionIds: [...directionIds],
        minSourceReliability: "all",
        minInfoCredibility: "all",
      },
      sources: [
        { ...snapshot, n: 1, documentId, briefId: null },
        { ...snapshot, n: 2, title: "Available brief", documentId: null, briefId },
        {
          ...snapshot,
          n: 3,
          title: "Unavailable",
          documentId: null,
          briefId: null,
          available: false,
        },
      ],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ["/axtaris"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: /Saved question/ }));
    expect(await screen.findByRole("link", { name: az.analytics.openDocument })).toHaveAttribute(
      "href",
      `/senedler/${documentId}`,
    );
    expect(screen.getByRole("link", { name: az.analytics.openBrief })).toHaveAttribute(
      "href",
      `/brifler/${briefId}`,
    );
    expect(
      screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", "1") }),
    ).toHaveAttribute("href", "#source-1");
    expect(document.getElementById("source-1")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: az.analytics.openSource.replace("{n}", "3") }),
    ).toBeNull();
    expect(screen.getByText(az.analytics.sourcesCount.replace("{count}", "2"))).toBeInTheDocument();
    expect(screen.queryByText(az.analytics.noSources)).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", {
        name: new RegExp(`${az.analytics.openDocument}|${az.analytics.openBrief}`),
      }),
    ).toHaveLength(2);
  });
  it("places recent queries on the right and sources below the synthesis", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ["/axtaris"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    const historyTitle = await screen.findByRole("heading", { name: az.analytics.historyTitle });
    const sourcesTitle = screen.getByText(az.analytics.sources);
    const synthesisTitle = screen.getByText(az.analytics.synthesis);
    const historyAside = historyTitle.closest("aside");
    const layout = historyAside?.parentElement;

    expect(historyAside).not.toBeNull();
    expect(layout).toHaveClass("grid", "lg:grid-cols-[minmax(0,1fr)_352px]");
    expect(
      sourcesTitle.compareDocumentPosition(historyTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      synthesisTitle.compareDocumentPosition(sourcesTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(layout?.firstElementChild?.contains(sourcesTitle)).toBe(true);
    expect(screen.getByText(az.analytics.emptyState)).toBeInTheDocument();
    expect(screen.getByText(az.analytics.historyEmpty)).toBeInTheDocument();
  });
});
