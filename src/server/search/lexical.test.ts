import { describe, expect, it } from "vitest";
import {
  buildLexicalQuery,
  buildSearchVariants,
  matchesNamedEntities,
  normalizeSearchText,
  rankLexicalMatches,
  tokenizeSearchQuery,
  MAX_SEARCH_VARIANTS,
} from "./lexical";

const corpus = [
  { id: "iran", title: "İran", body: "İranın enerji ixracı barədə hesabat." },
  { id: "russia", title: "Rusiya", body: "Rusiyanın enerji ixracı barədə hesabat." },
  { id: "defence", title: "Qərar", body: "müdafiə nazirinin təsdiqi" },
  { id: "partial", title: "müdafiə", body: "Müdafiə avadanlığının alınması." },
  { id: "unrelated", title: "İradə", body: "İradənin müzakirəsi və irfan dərsi." },
];
const search = (query: string, records = corpus) =>
  records
    .map((record) => ({ ...record, score: rankLexicalMatches(query, record) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ id }) => id);

describe("shared Azerbaijani lexical behavior on synthetic records", () => {
  it.each(["Iran", "İran", "İranın", "İranla", "İranda", "IRAN", "İRAN"])(
    "finds Iran, excludes unrelated countries: %s",
    (query) => {
      expect(search(query)).toEqual(["iran"]);
      expect(search(query, [{ id: "bare", title: "İran", body: "" }])).toEqual(["bare"]);
    },
  );
  it("matches possessive and case forms while requiring all concepts", () => {
    expect(search("müdafiə nazir təsdiq")).toEqual(["defence"]);
    expect(search("müdafiə nazirinin təsdiqi")).toEqual(["defence"]);
    expect(search("mudafie nazir tesdiq")).toEqual(["defence"]);
  });
  it("preserves I/İ/ı/i distinctions outside the explicit country alias", () => {
    expect(normalizeSearchText("I İ ı i")).toBe("ı i ı i");
    expect(
      search("İŞ", [
        { id: "wrong", title: "ış", body: "" },
        { id: "right", title: "iş", body: "" },
      ]),
    ).toEqual(["right"]);
    expect(search("ISIQ", [{ id: "wrong", title: "isiq", body: "" }])).toEqual([]);
  });
  it("normalizes composed Unicode and compatible query input", () => {
    expect(search("I\u0307RAN")).toEqual(["iran"]);
    expect(search("Ｉｒａｎ")).toEqual(["iran"]);
    expect(normalizeSearchText("  ƏŞIİ\t ENERJİ  ")).toBe("əşıi enerji");
  });
  it("uses bounded whole-word typo tolerance and no fuzzy/prefix matching for short terms", () => {
    expect(
      search("müdafə", [
        { id: "yes", title: "müdafiə", body: "" },
        { id: "no", title: "müddət", body: "" },
      ]),
    ).toEqual(["yes"]);
    expect(search("ir")).toEqual([]);
    expect(search("naz", [{ id: "no", title: "nazirinin", body: "" }])).toEqual([]);
    expect(search("müdafiə", [{ id: "no", title: "müdafiəxxxxxxxxxxxx", body: "" }])).toEqual([]);
    expect(search("İranaq", [{ id: "no", title: "İran", body: "" }])).toEqual([]);
  });
  it("ranks exact titles ahead of phrases, inflections and typos", () => {
    const records = [
      { id: "typo", title: "Digər", body: "təsdiqq" },
      { id: "morph", title: "Digər", body: "təsdiqi" },
      { id: "phrase", title: "Qərarın təsdiq mərhələsi", body: "" },
      { id: "exact", title: "təsdiq", body: "" },
    ];
    expect(search("təsdiq", records)).toEqual(["exact", "phrase", "morph", "typo"]);
  });
  it("bounds tokens/variants and treats query operators as data", () => {
    for (const group of buildSearchVariants("1234567 AB123456")) {
      expect(group.prefixes).toEqual([]);
      expect(group.variants).toEqual([group.token]);
      expect(group.fuzzy).toBe(false);
    }
    expect(tokenizeSearchQuery("alpha ".repeat(30))).toEqual(["alpha"]);
    expect(
      tokenizeSearchQuery(Array.from({ length: 50 }, (_, i) => `term${i}`).join(" ")),
    ).toHaveLength(12);
    expect(
      buildSearchVariants("İranın müdafiə təsdiqi").every(
        ({ variants }) => variants.length <= MAX_SEARCH_VARIANTS,
      ),
    ).toBe(true);
    expect(buildLexicalQuery("'); DROP TABLE documents; -- & ! :*")).not.toContain(";");
    expect(buildLexicalQuery("və də nə", "any")).toBe("");
  });
  it("keeps high-recall OR retrieval and constrains known named entities", () => {
    expect(rankLexicalMatches("müdafiə nazir təsdiq", corpus[3]!, "any")).toBeGreaterThan(0);
    expect(matchesNamedEntities("Iran", corpus[1]!)).toBe(false);
    expect(matchesNamedEntities("İranın enerji ixracı", corpus[0]!)).toBe(true);
    expect(matchesNamedEntities("Enerji təchizatında dolayı təsirlər", corpus[1]!)).toBe(true);
  });
});
