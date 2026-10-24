import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function materialCounts(materials: number, fragments: number, mode: "cited" | "retrieved") {
  return az.analytics.sourcesAndFragmentsCount
    .replace(
      "{materials}",
      (mode === "cited"
        ? az.analytics.citedSourcesCount
        : az.analytics.retrievedSourcesCount
      ).replace("{count}", String(materials)),
    )
    .replace(
      "{fragments}",
      (mode === "cited"
        ? az.analytics.citedFragmentsCount
        : az.analytics.retrievedFragmentsCount
      ).replace("{count}", String(fragments)),
    );
}

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
// Chunks 2 and 8 belong to the same parent document; every other chunk is its own document.
const groupedSources: AnalyticsSourcePreview[] = syntheticSources.map((source) =>
  source.n === 2 || source.n === 8
    ? { ...source, documentId: "shared-document", chunkId: `chunk-${source.n}` }
    : source,
);
function response(answer = "Nəticə [2][8].") {
  return new Response(
    [
      { type: "sources", sources: groupedSources },
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
  it("renders saved sparse citations consistently without changing the history snapshot", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([
      {
        id: "sparse",
        query: "Sparse history",
        status: "done",
        createdAt: "2026-10-22T08:00:00Z",
        durationMs: 10,
      },
    ]);
    const record = {
      id: "sparse",
      query: "Sparse history",
      status: "done" as const,
      answer: "Saved [1][2][7]. Again [7].",
      model: "test",
      durationMs: 10,
      createdAt: "2026-10-22T08:00:00Z",
      filters: {
        includeBriefs: false,
        period: "all" as const,
        directionIds: [...directionIds],
        minSourceReliability: "all" as const,
        minInfoCredibility: "all" as const,
      },
      sources: [1, 2, 7].map((n) => {
        const preview = groupedSources[n - 1]!;
        return {
          ...preview,
          available: true,
          caption: "Section",
          usedInAnswer: true,
          maxClassification: "open",
          model: "test",
          durationMs: 10,
          createdAt: "2026-10-22T08:00:00Z",
          preview,
        };
      }),
    };
    const snapshot = JSON.stringify(record);
    vi.mocked(getAnalyticsQueryHistory).mockResolvedValue(record);
    await openAnalytics();
    fireEvent.click(await screen.findByRole("button", { name: /Sparse history/ }));
    await screen.findByText(/Saved/);
    const links = screen.getAllByRole("link", {
      name: az.analytics.openSource.replace("{n}", "3"),
    });
    expect(links).toHaveLength(3); // Two references in the answer and one card link.
    for (const link of links) {
      expect(link).toHaveTextContent("[3]");
      expect(link).toHaveAttribute("href", expect.stringContaining("document%3Adocument-7-7"));
    }
    expect(JSON.stringify(record)).toBe(snapshot);
  });

  it("starts bulletin search ON and sends its selected value in each request", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    const transport = vi.fn(async (_url: unknown, _init?: RequestInit) => response());
    vi.stubGlobal("fetch", transport);
    await openAnalytics();
    const checkbox = screen.getByRole("checkbox", { name: "Bülletenlərdə də axtar" });
    expect(checkbox).toBeChecked();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Synthetic query" } });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.sourcesOnly }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string).filters.includeBriefs).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: az.analytics.sourcesOnly })).toBeEnabled(),
    );
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: az.analytics.sourcesOnly }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(JSON.parse(transport.mock.calls[1]![1]!.body as string).filters.includeBriefs).toBe(
      false,
    );
  });
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
        includeBriefs: false,
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
    const sourceLink = screen.getAllByRole("link", {
      name: az.analytics.openSource.replace("{n}", "1"),
    })[0]!;
    const fragmentId = decodeURIComponent(sourceLink.getAttribute("href")!.slice(1));
    expect(fragmentId).toContain(`document:${documentId}-1`);
    expect(document.getElementById(fragmentId)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: az.analytics.openSource.replace("{n}", "3") }),
    ).toBeNull();
    // One card per authorized parent: document + brief; unavailable metadata is inert.
    expect(screen.getAllByText(materialCounts(2, 2, "cited"))).toHaveLength(2);
    expect(screen.getByText(`[3] ${az.analytics.sourceUnavailable}`)).toBeInTheDocument();
    expect(screen.queryByText(/citedSourcesCount|\{count\}/)).toBeNull();
    expect(screen.queryByText(az.analytics.noSources)).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", {
        name: new RegExp(`${az.analytics.openDocument}|${az.analytics.openBrief}`),
      }),
    ).toHaveLength(2);
  });
  it("shows one card per material and counts retrieved fragments in sources-only mode", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            { type: "sources", sources: syntheticSources },
            { type: "final", answer: "", model: "", durationMs: 10 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.sourcesOnly }));
    await screen.findByText(az.analytics.fragmentsOnly);
    // 8 distinct parent documents.
    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(
      screen.getAllByText(
        az.analytics.sourcesAndFragmentsCount
          .replace("{materials}", az.analytics.retrievedSourcesCount.replace("{count}", "8"))
          .replace("{fragments}", az.analytics.retrievedFragmentsCount.replace("{count}", "8")),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/istinad edilmiş/)).toBeNull();
  });
  it("keeps authorized parent cards when history suppresses an unverifiable answer", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([
      {
        id: "legacy",
        query: "Legacy question",
        status: "done",
        createdAt: "2026-10-22T08:00:00Z",
        durationMs: 20,
      },
    ]);
    const metadata = {
      caption: "",
      usedInAnswer: false,
      maxClassification: "open",
      model: "test",
      durationMs: 20,
      createdAt: "2026-10-22T08:00:00Z",
    };
    vi.mocked(getAnalyticsQueryHistory).mockResolvedValue({
      id: "legacy",
      query: "Legacy question",
      status: "incomplete",
      answer: az.analytics.sourceUnavailable,
      model: "test",
      durationMs: 20,
      createdAt: metadata.createdAt,
      filters: {
        includeBriefs: false,
        period: "all",
        directionIds: [...directionIds],
        minSourceReliability: "all",
        minInfoCredibility: "all",
      },
      sources: [
        {
          ...metadata,
          n: 1,
          title: "Current authorized parent",
          available: true,
          documentId: "available-parent",
          briefId: null,
        },
        {
          ...metadata,
          n: 6,
          title: "Current authorized parent",
          available: true,
          documentId: "available-parent",
          briefId: null,
        },
        {
          ...metadata,
          n: 3,
          title: az.analytics.sourceUnavailable,
          available: false,
          documentId: null,
          briefId: null,
        },
      ],
    });
    await openAnalytics();
    fireEvent.click(await screen.findByRole("button", { name: /Legacy question/ }));
    expect(await screen.findByText(az.analytics.fragmentsOnly)).toBeInTheDocument();
    expect(screen.getAllByText(materialCounts(1, 2, "retrieved"))).toHaveLength(1);
    expect(screen.getByRole("link", { name: az.analytics.openDocument })).toHaveAttribute(
      "href",
      "/senedler/available-parent",
    );
    expect(screen.getByText(`[3] ${az.analytics.sourceUnavailable}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: az.analytics.copy })).toBeNull();
    expect(screen.queryByRole("button", { name: az.analytics.regenerate })).toBeNull();
    expect(screen.queryByText(/istinad edilmiş/)).toBeNull();
  });

  it("never counts retrieved material as cited when the answer has no citation", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response("Dəqiq göstərici təqdim edilməyib.")),
    );
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    await screen.findByRole("button", { name: az.analytics.regenerate });
    expect(screen.getAllByText(materialCounts(0, 0, "cited"))).toHaveLength(2);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByText("Synthetic source 1")).toBeNull();
  });
  it("removes a previously visible history answer when a fresh authorization check rejects it", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([
      {
        id: "revoked",
        query: "Revocable question",
        status: "done",
        createdAt: "2026-10-22T08:00:00Z",
        durationMs: 20,
      },
    ]);
    vi.mocked(getAnalyticsQueryHistory)
      .mockResolvedValueOnce({
        id: "revoked",
        query: "Revocable question",
        status: "done",
        answer: "Previously visible answer.",
        sources: [],
        model: "test",
        durationMs: 20,
        createdAt: "2026-10-22T08:00:00Z",
        filters: {
          includeBriefs: false,
          period: "all",
          directionIds: [...directionIds],
          minSourceReliability: "all",
          minInfoCredibility: "all",
        },
      })
      .mockResolvedValueOnce(null);
    await openAnalytics();
    const historyItem = await screen.findByRole("button", { name: /Revocable question/ });
    fireEvent.click(historyItem);
    await screen.findByText("Previously visible answer.");
    fireEvent.click(historyItem);
    expect(await screen.findByRole("alert")).toHaveTextContent(az.analytics.historyOpenFailed);
    expect(screen.queryByText("Previously visible answer.")).toBeNull();
    expect(screen.queryByRole("button", { name: az.analytics.copy })).toBeNull();
    expect(screen.queryByRole("button", { name: az.analytics.regenerate })).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(historyItem).toHaveAttribute("aria-current", "true");
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
    const historyAside = historyTitle.closest("aside");
    const layout = historyAside?.parentElement;

    expect(historyAside).not.toBeNull();
    expect(layout).toHaveClass("grid", "xl:grid-cols-[minmax(0,1fr)_280px]");
    expect(layout?.firstElementChild?.contains(sourcesTitle)).toBe(true);
    expect(
      sourcesTitle.compareDocumentPosition(historyTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(az.analytics.emptyState)).toBeInTheDocument();
    expect(
      screen.getByText(az.analytics.emptyState).compareDocumentPosition(sourcesTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(await screen.findByText(az.analytics.historyEmpty)).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: az.analytics.historyTitle });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(az.analytics.historyEmpty)).not.toBeVisible();
  });
});

describe("analytics regeneration and transport", () => {
  it("applies one display mapping after the validated SSE final event and leaves source-only numbers intact", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const sparseSources = syntheticSources.filter(({ n }) => [1, 2, 7].includes(n));
    const transport = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", transport);
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Sparse live query" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    const send = async (event: unknown) =>
      act(async () =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
      );
    await send({ type: "sources", sources: sparseSources });
    await send({ type: "delta", text: "Unvalidated [7]." });
    expect(screen.queryByText(/Unvalidated/)).toBeNull();
    expect(
      screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", "7") }),
    ).toHaveTextContent("[7]");
    await send({ type: "final", answer: "Validated [1][2][7]." });
    const renumbered = screen.getAllByRole("link", {
      name: az.analytics.openSource.replace("{n}", "3"),
    });
    expect(renumbered).toHaveLength(2);
    for (const link of renumbered)
      expect(link).toHaveAttribute("href", expect.stringContaining("document%3Adocument-7-7"));
    expect(
      screen.queryByRole("link", { name: az.analytics.openSource.replace("{n}", "7") }),
    ).toBeNull();
    await act(async () => controller.close());

    transport.mockResolvedValue(
      new Response(
        [
          { type: "sources", sources: sparseSources },
          { type: "final", answer: "" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: az.analytics.sourcesOnly }));
    await screen.findByText(az.analytics.fragmentsOnly);
    const original = screen.getByRole("link", {
      name: az.analytics.openSource.replace("{n}", "7"),
    });
    expect(original).toHaveTextContent("[7]");
    expect(
      within(screen.getAllByRole("article")[2]!).getByText("[7]", { selector: "span" }),
    ).toBeVisible();
  });

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
    // Chunks [2] and [8] belong to one document: two cited fragments, one cited material.
    expect(screen.getAllByText(materialCounts(1, 2, "cited"))).toHaveLength(2);
    expect(
      screen.getByText(az.analytics.citedFragmentsCount.replace("{count}", "2")),
    ).toBeInTheDocument();
    // [1] was returned by retrieval but never cited, so it is neither counted nor listed.
    expect(document.getElementById("source-1")).toBeNull();
    for (const link of screen.getAllByRole("link", {
      name: az.analytics.openSource.replace("{n}", "2"),
    })) {
      expect(link).toHaveAttribute("href", expect.stringContaining("document%3Ashared-document-8"));
    }
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
    await waitFor(() => expect(screen.getByText(/New answer/)).toBeInTheDocument());
  });
  it("lists each cited material once and keeps chunk-level citation numbers", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    await screen.findByRole("button", { name: az.analytics.regenerate });
    // Eight retrieved fragments from seven materials; only one material is cited.
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("Synthetic source 3")).toBeNull();
    // Answer mode counts only its cited evidence in the answer and source headers.
    // Retrieval-only mode has a separate test; uncited results must not inflate these counts.
    expect(screen.getAllByText(materialCounts(1, 2, "cited"))).toHaveLength(2);
    expect(
      screen.getByText(az.analytics.citedFragmentsCount.replace("{count}", "2")),
    ).toBeInTheDocument();
    expect(screen.queryByText(materialCounts(7, 8, "cited"))).toBeNull();
    for (const [n, displayN] of [
      [2, 1],
      [8, 2],
    ]) {
      for (const link of screen.getAllByRole("link", {
        name: az.analytics.openSource.replace("{n}", String(displayN)),
      })) {
        expect(link).toHaveAttribute(
          "href",
          expect.stringContaining(`document%3Ashared-document-${n}`),
        );
      }
    }
  });
  it("keeps legacy history read-only until an explicit new period is selected", async () => {
    const historicalFilters = {
      includeBriefs: false,
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
    fireEvent.click(screen.getByRole("button", { name: az.analytics.regenerate }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dövr seçin");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Historical answer.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dövr"), { target: { value: "90d" } });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.query).toBe(record.query);
    expect(body.filters).toMatchObject({
      filterVersion: 2,
      period: "90d",
      includeBriefs: false,
      sourceReliabilities: [],
      infoCredibilities: [],
    });
    expect(record.filters).toEqual(historicalFilters);
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
  it("clears delivered source previews and partial prose after a terminal access error", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    await act(async () => {
      streamController!.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "sources", sources: groupedSources })}\n\n`),
      );
      streamController!.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "delta", text: "Partial answer [2]." })}\n\n`,
        ),
      );
    });
    expect(screen.getByText("Synthetic source 2")).toBeInTheDocument();
    expect(screen.queryByText(/Partial answer/)).toBeNull();
    await act(async () => {
      streamController!.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "error", message: az.analytics.sourceUnavailable })}\n\n`,
        ),
      );
      streamController!.close();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(az.analytics.sourceUnavailable);
    expect(screen.queryByText("Synthetic source 2")).toBeNull();
    expect(screen.queryByText(/Partial answer/)).toBeNull();
    expect(screen.queryByRole("button", { name: az.analytics.regenerate })).toBeNull();
  });
});

describe("phase 2b history and progress lifecycle", () => {
  const saved = (id: string) => ({
    id,
    query: `Question ${id}`,
    filters: {
      includeBriefs: false,
      period: "7d" as const,
      directionIds: [...directionIds],
      minSourceReliability: "all" as const,
      minInfoCredibility: "all" as const,
    },
    answer: `Answer ${id}.`,
    status: "done" as const,
    sources: [],
    model: "test",
    durationMs: 100,
    createdAt: "2026-10-22T08:00:00Z",
  });

  it("selects and clears immediately, deduplicates pending clicks and rejects stale success and failure", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([saved("A"), saved("B")]);
    let finishA!: (value: ReturnType<typeof saved>) => void;
    let failB!: (error: Error) => void;
    vi.mocked(getAnalyticsQueryHistory)
      .mockResolvedValueOnce(saved("A"))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failB = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishA = resolve;
          }),
      );
    await openAnalytics();
    const a = await screen.findByRole("button", { name: /Question A/ });
    const b = screen.getByRole("button", { name: /Question B/ });
    fireEvent.click(a);
    await screen.findByText("Answer A.");
    const calls = vi.mocked(getAnalyticsQueryHistory).mock.calls.length;
    fireEvent.click(b);
    fireEvent.click(b);
    expect(vi.mocked(getAnalyticsQueryHistory).mock.calls.length).toBe(calls + 1);
    expect(b).toHaveAttribute("aria-current", "true");
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Answer A.")).toBeNull();
    expect(screen.getByRole("status", { name: az.analytics.historyLoading })).toBeInTheDocument();
    fireEvent.click(a);
    const oldSignal = vi.mocked(getAnalyticsQueryHistory).mock.calls.at(-2)![0]!.signal;
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => failB(new Error("late failure")));
    expect(a).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => finishA(saved("A")));
    await waitFor(() => expect(screen.getByText("Answer A.")).toBeInTheDocument());
    expect(a).toHaveAttribute("aria-current", "true");
    expect(a).toHaveAttribute("aria-busy", "false");
  });

  it("keeps a newer history result when an older ignored-abort request succeeds", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([saved("A"), saved("B")]);
    let finishA!: (value: ReturnType<typeof saved>) => void;
    vi.mocked(getAnalyticsQueryHistory)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishA = resolve;
          }),
      )
      .mockResolvedValueOnce(saved("B"));
    await openAnalytics();
    fireEvent.click(await screen.findByRole("button", { name: /Question A/ }));
    fireEvent.click(screen.getByRole("button", { name: /Question B/ }));
    await screen.findByText("Answer B.");
    await act(async () => finishA(saved("A")));
    expect(screen.getByText("Answer B.")).toBeInTheDocument();
    expect(screen.queryByText("Answer A.")).toBeNull();
  });

  it("parses fragmented CRLF milestones, ignores unknown progress, and releases on final before EOF", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(value) {
              controller = value;
            },
          }),
        ),
      ),
    );
    await openAnalytics();
    fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
    const send = async (text: string) =>
      act(async () => {
        controller.enqueue(new TextEncoder().encode(text));
      });
    await send('data: {"type":"progress","stage":"retrieval"}\r\n\r');
    await send('\ndata: {"type":"progress","stage":"unknown"}\r\n\r\n');
    expect(document.querySelector(".analytics-progress")).toHaveAttribute(
      "data-stage",
      "retrieval",
    );
    await send('data: {"type":"final","answer":"Checked result."}\r\n\r\n');
    await waitFor(() => expect(screen.getByText("Checked result.")).toBeInTheDocument());
    expect(document.querySelector(".analytics-progress")).toBeNull();
    expect(screen.getByRole("button", { name: az.analytics.regenerate })).toBeEnabled();
    await send('data: {"type":"error","message":"Late error"}\r\n\r\n');
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => controller.close());
  });

  it("clears pending at the client deadline even when transport ignores abort", async () => {
    vi.mocked(listRecentAnalyticsQueries).mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await openAnalytics();
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText(az.analytics.questionLabel), {
        target: { value: "Question" },
      });
      fireEvent.click(screen.getByRole("button", { name: az.analytics.searchButton }));
      await act(async () => vi.advanceTimersByTimeAsync(ANALYTICS_CLIENT_DEADLINE_MS));
      expect(screen.getByRole("alert")).toHaveTextContent(az.analytics.timeout);
      expect(document.querySelector(".analytics-progress")).toBeNull();
      expect(screen.getByRole("button", { name: az.analytics.searchButton })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
