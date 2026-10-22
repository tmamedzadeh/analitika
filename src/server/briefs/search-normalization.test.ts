import { describe, expect, it } from "vitest";

import { normalizeBriefSearch, buildBriefSearchQuery } from "./queries";
import { buildLexicalQuery } from "@/server/search/lexical";

describe("Azerbaijani lexical normalization", () => {
  it("normalizes Unicode, whitespace, case and meaningful letter distinctions", () => {
    const query = "  ƏŞIİ\t Enerji  ";
    expect(normalizeBriefSearch(query)).toBe("əşıi enerji");
    expect(buildBriefSearchQuery(query)).toBe(buildLexicalQuery(query));
    expect(buildBriefSearchQuery("ə e ş s ı i")).toBe("'ə' & 'e' & 'ş' & 's' & 'ı' & 'i'");
  });
});
