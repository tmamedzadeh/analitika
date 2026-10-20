import { render, screen } from "@testing-library/react";

import { OsintSourceCard, type OsintSourceCardData } from "./OsintSourceCard";

const source: OsintSourceCardData = {
  n: 3,
  url: "https://ednews.net/article?id=3",
  domain: "ednews.net",
  originalTitle: "İrəvanda məktəblərin sığınacaqları",
  originalLanguage: "en-US",
  publishedAt: "2026-10-20T12:00:00.000Z",
};

describe("OSINT source card", () => {
  it("shows only source details and safely opens the original publication", () => {
    render(<OsintSourceCard source={source} />);

    expect(
      screen.getByRole("heading", { name: "3 İrəvanda məktəblərin sığınacaqları" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-3");
    expect(document.getElementById("osint-source-3")).toBeInTheDocument();
    expect(screen.getByText("ednews.net · English · 20.10.2026")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Orijinalı aç" });
    expect(link).toHaveAttribute("href", "https://ednews.net/article?id=3");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/Exa|Tavily|Tam mətn|Təfərrüatlar/)).not.toBeInTheDocument();
  });

  it("hides unknown language and publication date metadata", () => {
    render(
      <OsintSourceCard source={{ ...source, originalLanguage: "de", publishedAt: "not-a-date" }} />,
    );

    expect(screen.getByText("ednews.net")).toBeInTheDocument();
    expect(screen.queryByText(/English|Azərbaycanca|20\.10\.2026/)).not.toBeInTheDocument();
  });

  it.each(["javascript:alert(1)", "https://localhost/article", "http://127.0.0.1/article"])(
    "does not render an original link for an unsafe URL (%s)",
    (url) => {
      render(<OsintSourceCard source={{ ...source, url }} />);
      expect(screen.queryByRole("link", { name: /Orijinalı aç/ })).not.toBeInTheDocument();
    },
  );
});
