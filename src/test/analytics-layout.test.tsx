import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { listRecentAnalyticsQueries } from "@/lib/analytics.functions";
import { az } from "@/lib/i18n/az";

vi.mock("@/lib/analytics.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics.functions")>();
  return {
    ...actual,
    listRecentAnalyticsQueries: vi.fn(),
  };
});

describe("analytics search layout", () => {
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
