import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZirveActionLabel, ZirveLoader, ZirveQueryIndicator, ZirveSkeleton } from "./ZirveLoader";

describe("ZirveLoader", () => {
  afterEach(() => vi.useRealTimers());

  it("waits before showing the compact animation and announces the loading state", () => {
    vi.useFakeTimers();
    const { container } = render(<ZirveLoader variant="compact" label="Məlumat yüklənir…" />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("data-visible", "false");

    act(() => vi.advanceTimersByTime(179));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Məlumat yüklənir…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("uses the supplied caption for page-level loading", () => {
    render(<ZirveLoader variant="page" delayMs={0} label="Sənəd yüklənir…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Sənəd yüklənir…");
    expect(screen.getByRole("status").querySelector("img")).toHaveAttribute("src", "/logo.png");
  });

  it("reserves skeleton space and delays background feedback without delaying content", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <>
        <ZirveSkeleton className="min-h-48" />
        <ZirveQueryIndicator fetching />
      </>,
    );
    expect(container.querySelector(".zirve-skeleton")).toHaveStyle({ opacity: "0" });
    expect(container.querySelector(".zirve-skeleton")).toHaveClass("min-h-48");
    expect(screen.queryByText("Məlumat yenilənir…")).toBeNull();
    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector(".zirve-skeleton")).toHaveStyle({ opacity: "1" });
    expect(screen.getByText("Məlumat yenilənir…")).toBeInTheDocument();
    rerender(<ZirveQueryIndicator fetching={false} />);
    expect(screen.queryByText("Məlumat yenilənir…")).toBeNull();
    expect(container.firstElementChild).toHaveClass("min-h-8");
  });

  it("announces only the current action label while preserving both label widths", () => {
    const { rerender } = render(
      <button>
        <ZirveActionLabel busy={false} label="Save" pendingLabel="Saving changes…" />
      </button>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByText("Saving changes…")).not.toBeVisible();
    rerender(
      <button aria-busy="true">
        <ZirveActionLabel busy label="Save" pendingLabel="Saving changes…" />
      </button>,
    );
    expect(screen.getByRole("button", { name: "Saving changes…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Save")).not.toBeVisible();
  });
});
