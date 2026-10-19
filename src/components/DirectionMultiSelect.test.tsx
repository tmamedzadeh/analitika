import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import { DirectionMultiSelect } from "@/components/DirectionMultiSelect";
import { directionIds, type DirectionId } from "@/lib/directions";
import { az } from "@/lib/i18n/az";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

let latest: DirectionId[] = [];

function Harness({ initial = [...directionIds] }: { initial?: DirectionId[] }) {
  const [value, setValue] = useState<DirectionId[]>(initial);
  latest = value;
  return <DirectionMultiSelect value={value} onChange={setValue} />;
}

describe("DirectionMultiSelect", () => {
  it("describes empty, single, partial and full selections", () => {
    const { unmount } = render(<Harness initial={[]} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("İstiqamət seçin");
    unmount();
    const single = render(<Harness initial={["OSINT"]} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("OSINT");
    single.unmount();
    const several = render(<Harness initial={["OSINT", "HUMINT", "IMINT"]} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("3 istiqamət seçilib");
    several.unmount();
    render(<Harness />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Bütün istiqamətlər");
  });
  it("updates the selection immediately and keeps it after closing", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Bütün istiqamətlər");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /^OSINT/ }));
    expect(latest).not.toContain("OSINT");
    expect(latest).toHaveLength(directionIds.length - 1);
    expect(trigger).toHaveTextContent("9 istiqamət seçilib");

    fireEvent.keyDown(screen.getByPlaceholderText(az.directions.search), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("9 istiqamət seçilib");
    expect(latest).not.toContain("OSINT");
  });

  it("supports clear, select all and search", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("button", { name: az.directions.clear }));
    expect(latest).toEqual([]);
    expect(trigger).toHaveTextContent("İstiqamət seçin");

    fireEvent.click(screen.getByRole("button", { name: az.directions.selectAll }));
    expect(latest).toEqual([...directionIds]);

    fireEvent.change(screen.getByPlaceholderText(az.directions.search), {
      target: { value: "tacint" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("TACINT / CI");
  });
});
