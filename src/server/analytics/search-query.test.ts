import { describe, expect, it } from "vitest";

import { buildFullTextQuery } from "./search";
import { buildSearchVariants, tokenGroupQuery, rankLexicalMatches } from "@/server/search/lexical";

describe("safe OR full-text query builder", () => {
  it("cleans Unicode tokens, removes Azerbaijani stop words, and adds long-token prefixes", () => {
    expect(buildFullTextQuery("Rusiya tərəfindən PUA / Ростов")).toBe(
      buildSearchVariants("Rusiya PUA Ростов", "any")
        .map((group) => tokenGroupQuery(group, true))
        .join(" | "),
    );
    expect(rankLexicalMatches("Rusiya PUA", { title: "Rusiya", body: "" }, "any")).toBeGreaterThan(
      0,
    );
  });

  it("deduplicates tokens and caps the query at twelve terms", () => {
    const built = buildFullTextQuery(
      "alpha alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega sigma tau",
    );
    expect(
      buildSearchVariants(
        "alpha alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega sigma tau",
        "any",
      ),
    ).toHaveLength(12);
    expect(built).toContain("'alpha'");
  });

  it("returns an empty expression when no eligible tokens remain", () => {
    expect(buildFullTextQuery("və də nə a 12")).toBe("");
    expect(buildFullTextQuery("a ı / -")).toBe("");
  });
});
