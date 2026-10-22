import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import {
  getDocumentDetails,
  getDocumentFormContext,
  listDocuments,
  prepareDocumentUploads,
  saveDocument,
} from "@/lib/documents.functions";
import { listBriefs } from "@/lib/briefs.functions";
import { az } from "@/lib/i18n/az";

vi.mock("@/lib/documents.functions", async (original) => ({
  ...(await original<typeof import("@/lib/documents.functions")>()),
  getDocumentDetails: vi.fn(),
  getDocumentFormContext: vi.fn(),
  listDocuments: vi.fn(),
  prepareDocumentUploads: vi.fn(),
  saveDocument: vi.fn(),
}));
vi.mock("@/lib/briefs.functions", async (original) => ({
  ...(await original<typeof import("@/lib/briefs.functions")>()),
  listBriefs: vi.fn(),
}));
vi.mock("@/lib/auth.functions", () => ({
  getSettingsIdentity: async () => ({
    id: "test",
    username: "test",
    role: "user",
    clearance: "open",
  }),
}));

const id = "00000000-0000-4000-8000-000000000001";
const createdAt = "2026-10-18T10:00:00.123456Z";
const card = {
  id,
  title: "Synthetic document",
  docDate: "2026-10-18",
  createdAt,
  direction: "OSINT",
  classification: "open",
  status: "ready" as const,
  preview: "Synthetic preview",
  hasAttachments: true,
  canManage: false,
};
const detail = {
  ...card,
  body: "Synthetic saved body",
  ownerId: "test",
  department: null,
  language: "az",
  sourceReliability: "F",
  infoCredibility: 6,
  updatedAt: createdAt,
  step: "ready",
  chunkCount: 1,
  progress: { percent: 100, totalChunks: 1, completedChunks: 1 },
  error: null,
  chunks: [],
  photos: [],
} as Awaited<ReturnType<typeof getDocumentDetails>>;
async function open(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDocuments).mockResolvedValue({ items: [card], nextCursor: null });
  vi.mocked(listBriefs).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(getDocumentFormContext).mockResolvedValue({ classifications: ["open"] });
  vi.mocked(getDocumentDetails).mockResolvedValue(detail);
});
afterEach(() => vi.restoreAllMocks());

describe("short catalog and creation route smoke with synthetic services", () => {
  it("loads later document pages and resets cursors on query/direction changes", async () => {
    vi.mocked(listDocuments)
      .mockResolvedValueOnce({ items: [card], nextCursor: { createdAt, id } })
      .mockResolvedValue({
        items: [{ ...card, id: "00000000-0000-4000-8000-000000000002", title: "Older document" }],
        nextCursor: null,
      });
    await open("/senedler");
    fireEvent.click(await screen.findByRole("button", { name: az.documentLibrary.loadMore }));
    expect(await screen.findByRole("link", { name: "Older document" })).toBeInTheDocument();
    expect(listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursor: { createdAt, id } }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(screen.queryByText(id)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: az.documentLibrary.search }), {
      target: { value: "Iran" },
    });
    fireEvent.click(screen.getByRole("button", { name: az.actions.search }));
    await waitFor(() =>
      expect(listDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ query: "Iran", cursor: null }) }),
      ),
    );
    fireEvent.change(screen.getByRole("combobox", { name: az.directions.field }), {
      target: { value: "OSINT" },
    });
    await waitFor(() =>
      expect(listDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { query: "Iran", direction: "OSINT", cursor: null } }),
      ),
    );
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("keeps bulletin filters with lexical search and makes no external API requests", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await open("/");
    const input = await screen.findByRole("textbox", { name: az.briefs.searchLabel });
    fireEvent.change(input, { target: { value: "müdafiə nazir təsdiq" } });
    fireEvent.click(screen.getByRole("button", { name: az.briefs.thisWeek }));
    await waitFor(() =>
      expect(listBriefs).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { query: "", period: "week", month: "", cursor: null } }),
      ),
    );
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(listBriefs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: { query: "müdafiə nazir təsdiq", period: "week", month: "", cursor: null },
        }),
      ),
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["/", az.briefs.searchLabel, listBriefs],
    ["/senedler", az.documentLibrary.search, listDocuments],
  ] as const)(
    "submits only confirmed text and deduplicates/reset searches on %s",
    async (path, label, service) => {
      await open(path);
      const input = await screen.findByRole("textbox", { name: label });
      await waitFor(() => expect(service).toHaveBeenCalled());
      const count = vi.mocked(service).mock.calls.length;
      for (const value of ["I", "Ir", "Iran"]) fireEvent.change(input, { target: { value } });
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(service).toHaveBeenCalledTimes(count);
      fireEvent.submit(input.closest("form")!);
      await waitFor(() =>
        expect(service).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ query: "Iran", cursor: null }),
          }),
        ),
      );
      const submittedCount = vi.mocked(service).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: az.actions.search }));
      expect(service).toHaveBeenCalledTimes(submittedCount);
      fireEvent.change(input, { target: { value: "" } });
      expect(service).toHaveBeenCalledTimes(submittedCount);
      fireEvent.submit(input.closest("form")!);
      await waitFor(() =>
        expect(service).toHaveBeenLastCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ query: "", cursor: null }) }),
        ),
      );
    },
  );
  it("preserves image upload/save and navigates from the separate form to the created document", async () => {
    const router = await open("/senedler/yeni");
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "test.png", {
      type: "image/png",
    });
    vi.mocked(prepareDocumentUploads).mockResolvedValue({
      documentId: id,
      uploads: [
        {
          attachmentId: id,
          name: file.name,
          mime: "image/png",
          size: file.size,
          key: "synthetic-key",
          url: "https://synthetic.test/upload",
        },
      ],
    });
    vi.mocked(saveDocument).mockResolvedValue({ documentId: id, queueFailed: false });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    fireEvent.change(await screen.findByPlaceholderText(az.documents.form.titlePlaceholder), {
      target: { value: card.title },
    });
    fireEvent.change(screen.getByPlaceholderText(az.documents.form.bodyPlaceholder), {
      target: { value: "Synthetic saved body" },
    });
    const direction = document.querySelector('select[name="direction"]')!;
    fireEvent.change(direction, { target: { value: "OSINT" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/senedler/${id}`));
    expect(fetch).toHaveBeenCalledWith(
      "https://synthetic.test/upload",
      expect.objectContaining({ method: "PUT", body: file }),
    );
    expect(saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: card.title,
          direction: "OSINT",
          uploads: [expect.objectContaining({ key: "synthetic-key" })],
        }),
      }),
    );
    expect(await screen.findByText("Synthetic saved body")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("keeps citation deep links on the document detail route", async () => {
    const router = await open(`/senedler/${id}?chunk=00000000-0000-4000-8000-000000000002`);
    expect(await screen.findByText("Synthetic saved body")).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      chunk: "00000000-0000-4000-8000-000000000002",
    });
    expect(getDocumentDetails).toHaveBeenCalledWith({ data: { documentId: id } });
  });
});
