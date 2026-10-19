import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { getDocumentDetails, listRecentDocuments } from "@/lib/documents.functions";
import { az } from "@/lib/i18n/az";

vi.mock("@/lib/documents.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents.functions")>();
  return {
    ...actual,
    getDocumentDetails: vi.fn(),
    listRecentDocuments: vi.fn(),
  };
});

const documentId = "2c227f83-a225-4b68-9492-979cd1d59f13";
const documentTitle = "Test document details";

const detail = {
  id: documentId,
  title: documentTitle,
  body: "Known source text for the selected document.",
  department: "d3",
  direction: null,
  docDate: "2026-10-18",
  tags: ["operations"],
  language: "az",
  classification: "open",
  sourceReliability: "B",
  infoCredibility: 2,
  ownerId: "admin",
  status: "ready",
  step: "ready",
  chunkCount: 1,
  progress: { percent: 100, completedChunks: 1, totalChunks: 1 },
  error: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
  chunks: [],
  photos: [],
};

const recentDocument = {
  id: documentId,
  title: documentTitle,
  status: "ready",
  step: "ready",
  progress: { percent: 100, completedChunks: 1, totalChunks: 1 },
  error: null,
  docDate: "2026-10-18",
  direction: null,
  createdAt: "2026-10-18T10:00:00.000Z",
  chunkCount: 1,
} as Awaited<ReturnType<typeof listRecentDocuments>>[number];

async function makeRouter(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router;
}

describe("document detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRecentDocuments).mockResolvedValue([recentDocument]);
    vi.mocked(getDocumentDetails).mockResolvedValue(
      detail as Awaited<ReturnType<typeof getDocumentDetails>>,
    );
  });

  it("opens the exact recent document and loads its UUID from the route", async () => {
    const router = await makeRouter("/senedler");
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("link", { name: documentTitle }));

    expect(await screen.findByRole("heading", { name: documentTitle })).toBeInTheDocument();
    expect(
      await screen.findByText("Known source text for the selected document."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(getDocumentDetails).toHaveBeenCalledWith({ data: { documentId } });
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the page loader for a slow document request and removes it on success", async () => {
    let resolveDocument!: (value: Awaited<ReturnType<typeof getDocumentDetails>>) => void;
    vi.mocked(getDocumentDetails).mockImplementation(
      () => new Promise((resolve) => (resolveDocument = resolve)),
    );
    const router = await makeRouter(`/senedler/${documentId}`);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("status")).toHaveTextContent(az.loader.loading);
    await act(async () => {
      resolveDocument(detail as Awaited<ReturnType<typeof getDocumentDetails>>);
    });

    expect(await screen.findByRole("heading", { name: documentTitle })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a not-found state for an invalid UUID without requesting the server", async () => {
    const router = await makeRouter("/senedler/not-a-uuid");
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: az.documents.missing })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: az.documents.backToList })).toBeInTheDocument();
    expect(getDocumentDetails).not.toHaveBeenCalled();
  });

  it("shows a not-found state when the UUID has no matching record", async () => {
    vi.mocked(getDocumentDetails).mockResolvedValue(null);
    const router = await makeRouter(`/senedler/${documentId}`);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: az.documents.missing })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: az.documents.backToList })).toBeInTheDocument();
  });

  it("shows a recoverable error state when the server request fails", async () => {
    vi.mocked(getDocumentDetails).mockRejectedValue(new Error("database unavailable"));
    const router = await makeRouter(`/senedler/${documentId}`);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(az.documents.loadError);
    expect(screen.getByRole("button", { name: az.actions.retry })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: az.documents.backToList })).toBeInTheDocument();
  });

  it("shows an explicit empty-content state for an existing blank document", async () => {
    vi.mocked(getDocumentDetails).mockResolvedValue({ ...detail, body: "" } as Awaited<
      ReturnType<typeof getDocumentDetails>
    >);
    const router = await makeRouter(`/senedler/${documentId}`);
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(az.documents.emptyContent)).toBeInTheDocument();
  });
});
