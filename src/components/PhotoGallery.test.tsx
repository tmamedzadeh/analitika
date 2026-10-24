import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { PhotoGallery } from "./PhotoGallery";
import { loadPrivateImage } from "@/lib/private-image";
vi.mock("@/lib/private-image", () => ({ loadPrivateImage: vi.fn() }));
const photos = Array.from({ length: 10 }, (_, i) => ({
  id: `photo-${i}`,
  name: `Synthetic ${i + 1}`,
  url: `/api/attachments/document/parent/photo-${i}`,
}));
beforeEach(() => {
  vi.mocked(loadPrivateImage)
    .mockReset()
    .mockResolvedValue(new Blob([new Uint8Array([1])], { type: "image/png" }));
  URL.createObjectURL = vi.fn(() => "blob:synthetic-private");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());
describe("shared private photo gallery", () => {
  it("opens the chosen image, arrows, zoom, Escape and restores focus", async () => {
    render(<PhotoGallery photos={photos} title="Synthetic gallery" />);
    const trigger = screen.getByRole("button", { name: "Synthetic 2 · 2 / 10" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("2 / 10")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Şəkli böyüt" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Şəkli böyüt" }));
    expect(screen.getAllByRole("button", { name: "Miqyası sıfırla" }).length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(screen.getByText("2 / 10")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("handles loading/error/retry, one-photo controls, close and reopen", async () => {
    vi.mocked(loadPrivateImage).mockRejectedValueOnce(new Error("Synthetic denied"));
    render(<PhotoGallery photos={photos.slice(0, 1)} title="Synthetic bulletin" />);
    const trigger = screen.getByRole("button", { name: /Synthetic 1 ·/ });
    fireEvent.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent("əlçatan deyil");
    expect(screen.queryByRole("button", { name: "Növbəti şəkil" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Qalereyanı bağla" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(trigger);
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });
});
