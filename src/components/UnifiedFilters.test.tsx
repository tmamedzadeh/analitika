import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PeriodFilter } from "./PeriodFilter";
import { ReliabilityFilters, type ReliabilitySelection } from "./ReliabilityFilters";
import { getBakuDate } from "@/lib/briefs";
import type { PeriodFilter as PeriodValue } from "@/lib/period";

describe("shared filter interaction", () => {
  it("keeps a custom draft unapplied until confirmation, accepts one day and clears stale dates", () => {
    const onChange = vi.fn();
    function Example() {
      const [value, setValue] = useState<PeriodValue>({ period: "30d" });
      return (
        <PeriodFilter
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Example />);
    const select = screen.getByRole("combobox", { name: "Dövr" });
    expect(screen.getByRole("option", { name: "Hamısı" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "custom" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Tətbiq et" })).toBeDisabled();
    const today = getBakuDate();
    const date = new Date(`${today}T12:00:00`);
    const button = [...document.querySelectorAll<HTMLButtonElement>("button[data-day]")].find(
      (node) => node.dataset["day"] === date.toLocaleDateString(),
    )!;
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tətbiq et" }));
    expect(onChange).toHaveBeenLastCalledWith({ period: "custom", from: today, to: today });
    fireEvent.change(select, { target: { value: "90d" } });
    expect(onChange).toHaveBeenLastCalledWith({ period: "90d" });
    fireEvent.change(select, { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Ləğv et" }));
    expect(select).toHaveValue("90d");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it("selects a sorted range on two clicks, highlights its middle and disables future days", () => {
    const onChange = vi.fn();
    render(<PeriodFilter value={{ period: "30d" }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Dövr" }), {
      target: { value: "custom" },
    });
    const today = getBakuDate();
    const start = today.slice(0, 8) + "01";
    function click(value: string) {
      const day = new Date(`${value}T12:00:00`);
      fireEvent.click(
        [...document.querySelectorAll<HTMLButtonElement>("button[data-day]")].find(
          (node) => node.dataset["day"] === day.toLocaleDateString(),
        )!,
      );
    }
    click(today);
    click(start);
    if (Number(today.slice(-2)) > 2)
      expect(document.querySelector('[data-range-middle="true"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tətbiq et" }));
    expect(onChange).toHaveBeenCalledWith({ period: "custom", from: start, to: today });
  });
  it("supports precise multiple ratings, visible selected values and clearing", () => {
    const onChange = vi.fn();
    function Example() {
      const [value, setValue] = useState<ReliabilitySelection>({
        sourceReliabilities: [],
        infoCredibilities: [],
      });
      return (
        <ReliabilityFilters
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Mənbə etibarlılığı: Hamısı" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^A ·/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^C ·/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      sourceReliabilities: ["A", "C"],
      infoCredibilities: [],
    });
    expect(screen.getByRole("button", { name: "Mənbə etibarlılığı: A, C" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^F ·/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seçimi təmizlə" }));
    expect(onChange).toHaveBeenLastCalledWith({ sourceReliabilities: [], infoCredibilities: [] });
  });
});
