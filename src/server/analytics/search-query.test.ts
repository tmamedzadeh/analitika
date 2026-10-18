import { describe, expect, it } from "vitest";

import { buildFullTextQuery } from "./search";

describe("safe OR full-text query builder", () => {
  it("cleans Unicode tokens, removes Azerbaijani stop words, and adds long-token prefixes", () => {
    expect(buildFullTextQuery("Rusiya tərəfindən PUA / Ростов")).toBe("rusiya:* | pua | ростов:*");
  });

  it("deduplicates tokens and caps the query at twelve terms", () => {
    const built = buildFullTextQuery(
      "alpha alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega sigma tau",
    );
    expect(built.split(" | ")).toHaveLength(12);
    expect(built.split(" | ").filter((token) => token === "alpha")).toHaveLength(1);
  });

  it("returns an empty expression when no eligible tokens remain", () => {
    expect(buildFullTextQuery("və də nə a 12")).toBe("");
    expect(buildFullTextQuery("a ı / -")).toBe("");
  });
});
