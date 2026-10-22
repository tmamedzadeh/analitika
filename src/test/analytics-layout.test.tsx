import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { getAnalyticsQueryHistory, listRecentAnalyticsQueries } from "@/lib/analytics.functions";
import { directionIds } from "@/lib/directions";
import { az } from "@/lib/i18n/az";
import {
  ANALYTICS_CLIENT_DEADLINE_MS,
  ANALYTICS_SERVER_DEADLINE_MS,
  type AnalyticsSourcePreview,
} from "@/lib/analytics";

afterEach(() => vi.unstubAllGlobals());

async function openAnalytics() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/axtaris"] }),
  });
  await router.load();
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: az.analytics.searchButton });
  return result;
}
const syntheticSources: AnalyticsSourcePreview[] = Array.from({ length: 8 }, (_, index) => ({
  n: index + 1,
  sourceKind: "document",
  documentId: `document-${index + 1}`,
  briefId: null,
  chunkId: `chunk-${index + 1}`,
  title: `Synthetic source ${index + 1}`,
  sectionTitle: "Section",
  docDate: "2026-10-21",
  briefDate: null,
  quote: "Invented test excerpt",
  sourceReliability: "A",
  infoCredibility: 1,
  direction: "OSINT",
  classification: "open",
  isTable: false,
  attachmentCount: 0,
}));
function response(answer = "Nəticə [2][8].") {
  return new Response(
    [
      { type: "sources", sources: syntheticSources },
      { type: "final", answer, model: "gemini-3.1-flash-lite", durationMs: 1000 },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

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
    expect(
      screen.getAllByText(az.analytics.citedSourcesCount.replace("{count}", "2")),
    ).toHaveLength(2);
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
    expect(layout).toHaveClass("grid", "xl:grid-cols-[minmax(0,1fr)_280px]");
    expect(
      sourcesTitle.compareDocumentPosition(historyTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      synthesisTitle.compareDocumentPosition(sourcesTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(layout?.firstElementChild?.contains(sourcesTitle)).toBe(true);
    expect(screen.getByText(az.analytics.emptyState)).toBeInTheDocument();
    expect(screen.getByText(az.analytics.historyEmpty)).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: az.analytics.historyTitle });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(az.analytics.historyEmpty)).not.toBeVisible();
  });
});

describe("analytics regeneration and transport", () => {
  it("retains the displayed question and filters after form edits, prevents duplicate runs and preserves source numbers", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    let finish: ((value: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Original question" },
    });
    fireEvent.change(screen.getByLabelText(az.analytics.periodLabel), { target: { value: "30d" } });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    await screen.findByRole("button", { name: az.analytics.regenerate });
    expect(
      screen.getAllByText(az.analytics.citedSourcesCount.replace("{count}", "2")),
    ).toHaveLength(2);
    expect(document.getElementById("source-8")).toBeInTheDocument();
    expect(document.getElementById("source-1")).toBeNull();
    expect(
      screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", "8") }),
    ).toHaveAttribute("href", "#source-8");
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Edited question" },
    });
    fireEvent.change(screen.getByLabelText(az.analytics.periodLabel), { target: { value: "all" } });
    const regenerate = screen.getByRole("button", { name: az.analytics.regenerate });
    fireEvent.click(regenerate);
    fireEvent.click(regenerate);
    expect(fetch).toHaveBeenCalledTimes(2);
    const original = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(original);
    expect(original).toMatchObject({
      query: "Original question",
      filters: { period: "30d" },
      mode: "answer",
    });
    expect(screen.getByRole("heading", { name: "Original question" })).toBeInTheDocument();
    await act(async () => finish!(response("New answer [8].")));
    expect(await screen.findByText(/New answer/)).toBeInTheDocument();
  });
  it("regenerates history using its own request without sending an update ID", async () => {
    const historicalFilters = {
      period: "90d" as const,
      directionIds: [...directionIds],
      minSourceReliability: "B" as const,
      minInfoCredibility: "2" as const,
    };
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([
      {
        id: "saved",
        query: "Historical question",
        status: "done",
        createdAt: "2026-10-22T08:00:00Z",
        durationMs: 100,
      },
    ]);
    const record = {
      id: "saved",
      query: "Historical question",
      filters: historicalFilters,
      answer: "Historical answer.",
      status: "done" as const,
      sources: [],
      model: "gemini-3.1-flash-lite",
      durationMs: 100,
      createdAt: "2026-10-22T08:00:00Z",
    };
    vi.mocked(getAnalyticsQueryHistory).mockResolvedValue(record);
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    await openAnalytics();
    const historyItem = await screen.findByRole("button", { name: /Historical question/ });
    fireEvent.click(historyItem);
    await screen.findByRole("button", { name: az.analytics.regenerate });
    expect(historyItem).toHaveAttribute("aria-current", "true");
    fireEvent.change(screen.getByLabelText(az.analytics.periodLabel), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Unrelated" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.regenerate }));
    await screen.findByText(/Nəticə/);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      query: record.query,
      filters: historicalFilters,
      mode: "answer",
    });
    expect(record.answer).toBe("Historical answer.");
  });
  it("waits beyond the server deadline and aborts on user stop", async () => {
    expect(ANALYTICS_CLIENT_DEADLINE_MS).toBeGreaterThanOrEqual(
      ANALYTICS_SERVER_DEADLINE_MS + 5000,
    );
    expect(ANALYTICS_CLIENT_DEADLINE_MS).toBeLessThanOrEqual(120_000);
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason)),
        );
      }),
    );
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: az.analytics.cancel }));
    expect(await screen.findByRole("alert")).toHaveTextContent(az.analytics.cancelled);
    expect(signal?.aborted).toBe(true);
  });
  it("rejects a disconnected stream without a terminal event and hides its source metadata", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            `data: ${JSON.stringify({ type: "sources", sources: syntheticSources })}\n\n`,
          ),
        ),
    );
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(az.analytics.answerFailed),
    );
    expect(screen.queryByText("Synthetic source 1")).toBeNull();
    expect(screen.queryByRole("button", { name: az.analytics.regenerate })).toBeNull();
  });
});
