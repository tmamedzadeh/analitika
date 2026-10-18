import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZirveLoader } from "./ZirveLoader";

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
});
