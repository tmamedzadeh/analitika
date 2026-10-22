import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalyticsAnswer } from "./AnalyticsAnswer";
import { az } from "@/lib/i18n/az";

describe("analytics citation links", () => {
  it("links numbered citations to source cards supplied by the server", () => {
    render(
      <AnalyticsAnswer
        answer="Nəticə [1]. Müqayisə [2][3]."
        sources={[{ n: 1 }, { n: 2 }, { n: 3 }]}
      />,
    );
    for (const n of [1, 2, 3]) {
      expect(
        screen.getByRole("link", { name: az.analytics.openSource.replace("{n}", String(n)) }),
      ).toHaveAttribute("href", `#source-${n}`);
    }
  });

  it("uses no model-authored URL as a document or citation destination", () => {
    const { container } = render(
      <AnalyticsAnswer
        answer="Nəticə [1](https://untrusted.test/senedler/secret). [Hesabat](https://untrusted.test/report) [Daxili sənəd](/senedler/secret)."
        sources={[{ n: 1 }]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "#source-1");
    expect(container.querySelector('a[href*="untrusted"]')).toBeNull();
    expect(container.querySelector('a[href*="secret"]')).toBeNull();
    expect(container).toHaveTextContent("Hesabat");
  });

  it("keeps unavailable history sources and unknown source numbers non-clickable", () => {
    render(
      <AnalyticsAnswer
        answer="Nəticə [1][2][99]."
        sources={[
          { n: 1, available: true },
          { n: 2, available: false },
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("[2]")).toBeInTheDocument();
    expect(screen.getByText("[99]")).toBeInTheDocument();
  });
});
