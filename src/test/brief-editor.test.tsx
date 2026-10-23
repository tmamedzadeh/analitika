import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import {
  getBrief,
  getBriefFormContext,
  prepareBriefUploads,
  saveBrief,
} from "@/lib/briefs.functions";
import type { Brief } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

vi.mock("@/lib/briefs.functions", async (original) => ({
  ...(await original<typeof import("@/lib/briefs.functions")>()),
  getBrief: vi.fn(),
  getBriefFormContext: vi.fn(),
  prepareBriefUploads: vi.fn(),
  saveBrief: vi.fn(),
}));
vi.mock("@/lib/auth.functions", () => ({
  getSettingsIdentity: async () => ({
    id: "synthetic",
    username: "synthetic",
    role: "user",
    clearance: "open",
  }),
}));
const id = "00000000-0000-4000-8000-000000000001";
const brief: Brief = {
  id,
  date: "2026-10-22",
  title: "Synthetic bulletin",
  body: "Synthetic alfa beta.",
  classification: "open",
  status: "published",
  indexStatus: "ready",
  indexProgress: { percent: 100, totalChunks: 1, completedChunks: 1 },
  photos: [],
  publishedAt: "2026-10-22T00:00:00Z",
  highlight: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBriefFormContext).mockResolvedValue({
    classifications: ["open"],
    canDeclassify: false,
  });
  vi.mocked(getBrief).mockResolvedValue({
    brief,
    canEdit: true,
    canDelete: false,
    previousId: null,
    nextId: null,
  });
  vi.mocked(saveBrief).mockResolvedValue({
    ok: true,
    briefId: id,
    queueFailed: false,
    cleanupIncomplete: false,
  });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected test network request.")));
});
afterEach(() => vi.unstubAllGlobals());

describe("isolated bulletin create/edit navigation", () => {
  it.each([false, true])(
    "saves an open bulletin and opens its detail (editing=%s)",
    async (editing) => {
      vi.mocked(prepareBriefUploads).mockResolvedValue({
        briefId: id,
        isNew: !editing,
        uploads: [],
      });
      const router = createRouter({
        routeTree,
        context: {
          queryClient: new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
          }),
        },
        history: createMemoryHistory({
          initialEntries: [editing ? `/brifler/${id}/redakte` : "/brifler/yeni"],
        }),
      });
      await router.load();
      render(<RouterProvider router={router} />);
      fireEvent.change(await screen.findByLabelText(az.briefs.titleField, { exact: true }), {
        target: { value: brief.title },
      });
      fireEvent.change(screen.getByPlaceholderText(az.briefs.bodyPlaceholder), {
        target: { value: "Updated synthetic alfa beta." },
      });
      fireEvent.click(screen.getByRole("button", { name: az.briefs.save }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/brifler/${id}`));
      expect(prepareBriefUploads).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classification: "open",
            body: "Updated synthetic alfa beta.",
            ...(editing ? { briefId: id } : {}),
          }),
        }),
      );
      expect(saveBrief).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            briefId: id,
            isNew: !editing,
            classification: "open",
            uploads: [],
          }),
        }),
      );
      expect(await screen.findByRole("heading", { name: brief.title })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
