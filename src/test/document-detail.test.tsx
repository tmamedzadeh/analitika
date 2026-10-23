import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import {
  getDocumentDetails,
  getDocumentFormContext,
  listDocuments,
} from "@/lib/documents.functions";
import { az } from "@/lib/i18n/az";
import { directionLabel } from "@/lib/directions";

vi.mock("@/lib/documents.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents.functions")>();
  return {
    ...actual,
    getDocumentFormContext: vi.fn(),
    getDocumentDetails: vi.fn(),
    listDocuments: vi.fn(),
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
  canManage: false,
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
  preview: detail.body,
  classification: "open",
  hasAttachments: false,
  canManage: false,
} as Awaited<ReturnType<typeof listDocuments>>["items"][number];

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
    vi.mocked(getDocumentFormContext).mockResolvedValue({
      classifications: ["open", "secret", "top_secret", "special"],
    });
    vi.mocked(listDocuments).mockResolvedValue({ items: [recentDocument], nextCursor: null });
    vi.mocked(getDocumentDetails).mockResolvedValue(
      detail as Awaited<ReturnType<typeof getDocumentDetails>>,
    );
  });

  it("opens the exact catalog document and loads its UUID from the route", async () => {
    const router = await makeRouter("/senedler");
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("link", { name: documentTitle }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/senedler/${documentId}`));

    expect(await screen.findByRole("heading", { name: documentTitle })).toBeInTheDocument();
    expect(
      await screen.findByText("Known source text for the selected document."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: az.documents.delete })).toBeNull();
    await waitFor(() => {
      expect(getDocumentDetails).toHaveBeenCalledWith({ data: { documentId } });
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reserves a detail skeleton for a slow document request and removes it on success", async () => {
    let resolveDocument!: (value: Awaited<ReturnType<typeof getDocumentDetails>>) => void;
    vi.mocked(getDocumentDetails).mockImplementation(
      () => new Promise((resolve) => (resolveDocument = resolve)),
    );
    const router = await makeRouter(`/senedler/${documentId}`);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("status", { name: az.loader.loading })).toHaveClass(
      "zirve-skeleton",
      "min-h-64",
    );
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

  it("shows the delete action only to document managers", async () => {
    vi.mocked(getDocumentDetails).mockResolvedValue({
      ...detail,
      canManage: true,
    } as Awaited<ReturnType<typeof getDocumentDetails>>);
    const router = await makeRouter(`/senedler/${documentId}`);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("button", { name: az.documents.delete })).toBeInTheDocument();
  });

  it.each([false, true])(
    "keeps source text and direction visible without direction editing or fragment controls (manager: %s)",
    async (canManage) => {
      vi.mocked(getDocumentDetails).mockResolvedValue({
        ...detail,
        direction: "OSINT",
        canManage,
        chunks: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            ord: 0,
            sectionTitle: "",
            text: detail.body,
            charStart: 0,
            charEnd: detail.body.length,
            isTable: false,
          },
        ],
      } as Awaited<ReturnType<typeof getDocumentDetails>>);
      const router = await makeRouter(`/senedler/${documentId}`);
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole("heading", { name: documentTitle })).toBeInTheDocument();
      expect(screen.getAllByText(detail.body)).toHaveLength(1);
      expect(screen.getByText(directionLabel("OSINT")!)).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("button", { name: /İstiqaməti yadda saxla/ })).toBeNull();
      expect(screen.queryByText(/indeks fraqmenti/)).toBeNull();
      expect(screen.queryByRole("button", { name: /1\. Mətn/ })).toBeNull();
    },
  );
});
