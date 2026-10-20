import { describe, expect, it } from "vitest";

import { plainTextFragment } from "./osint-text";

describe("OSINT plain source fragments", () => {
  it("removes Markdown and markup without returning a heading", () => {
    expect(plainTextFragment("# Heading\n\n**Bold** [link](https://example.org)")).toBe(
      "Heading Bold link",
    );
  });

  it("keeps fragments within the limit and truncates at a word boundary", () => {
    const result = plainTextFragment("alpha beta gamma delta", 13);
    expect(result).toBe("alpha beta");
    expect(result.length).toBeLessThanOrEqual(13);
  });
});
