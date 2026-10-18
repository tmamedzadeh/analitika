import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BriefMarkdown } from "./BriefMarkdown";

describe("BriefMarkdown", () => {
  it("ignores raw HTML and remote markdown images, and hardens links", () => {
    const { container, getByRole, queryByText } = render(
      <BriefMarkdown
        markdown={
          '<script>alert("x")</script>\n\n![x](https://example.com/image.png)\n\n[unsafe](javascript:alert(1)) [safe](https://example.com)'
        }
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(queryByText('alert("x")')).toBeNull();
    expect(getByRole("link", { name: "safe" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(getByRole("link", { name: "safe" })).toHaveAttribute("target", "_blank");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("highlights the markdown block whose source offsets overlap the selected chunk", () => {
    const markdown = "Birinci abzas.\n\nİkinci abzas.";
    const { container } = render(
      <BriefMarkdown markdown={markdown} highlight={{ start: 17, end: markdown.length }} />,
    );
    expect(container.querySelector('[data-chunk-highlight="true"]')?.textContent).toBe(
      "İkinci abzas.",
    );
  });
});
