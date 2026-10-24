import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { withCurrentUser, type SessionUser } from "@/server/auth";
import { buildBriefListConditions, buildBriefSearchQuery, normalizeBriefSearch } from "./queries";
import { rankLexicalMatches, tokenGroupQuery, buildSearchVariants } from "@/server/search/lexical";

const user: SessionUser = {
  id: "brief-search-user",
  username: "analyst",
  role: "user",
  clearance: "secret",
  sessionId: "brief-search-session",
};

const defaults = { query: "", period: "30d" as const, cursor: null };
type Filters = Parameters<typeof buildBriefListConditions>[0];

function compile(filters: Filters) {
  return withCurrentUser(user, () => {
    const condition = buildBriefListConditions(filters);
    return condition.map((item) => new PgDialect().sqlToQuery(item));
  });
}

describe("Xülasələr lexical search", () => {
  it("builds an AND tsquery from words without phrase ordering", () => {
    expect(buildBriefSearchQuery("enerji təhlükəsizliyi").split(" & ")).toHaveLength(2);
    expect(
      rankLexicalMatches("təhlükəsizliyi enerji", { title: "Enerji təhlükəsizliyi", body: "" }),
    ).toBeGreaterThan(0);
    expect(rankLexicalMatches("enerji təhlükəsizliyi", { title: "Enerji", body: "" })).toBe(0);
  });

  it("normalizes Unicode, case, and whitespace consistently using Azerbaijani casing", () => {
    expect(normalizeBriefSearch("  İRAN\t   ENERJİ  ")).toBe("iran enerji");
    expect(normalizeBriefSearch("IĞDIR İŞIĞI ƏŞYA ÖLÇÜ ÇAĞRI")).toBe("ığdır işığı əşya ölçü çağrı");
    expect(normalizeBriefSearch("A\u0307")).toBe(
      "a\u0307".normalize("NFC").toLocaleLowerCase("az-Latn-AZ").normalize("NFC"),
    );
  });

  it("preserves Azerbaijani letter distinctions instead of transliterating", () => {
    expect(buildBriefSearchQuery("ə e ş s ı i")).toBe("'ə' & 'e' & 'ş' & 's' & 'ı' & 'i'");
    expect(normalizeBriefSearch("ƏŞIİ")).toBe("əşıi");
  });

  it("uses normalized lexical search and keeps access, filters, and date/ID pagination conditions", () => {
    const conditions = compile({
      ...defaults,
      query: "Enerji   təhlükəsizliyi",
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-12",
      cursor: { date: "2026-10-12", id: "00000-0000-4000-8000-000001" },
    });
    const sql = conditions.map((query) => query.sql).join(" ");
    const params = conditions.flatMap((query) => query.params);
    expect(sql).toContain("to_tsvector('simple'::regconfig, lower(translate(normalize(");
    expect(sql).toContain("to_tsquery('simple'::regconfig");
    for (const group of buildSearchVariants("enerji təhlükəsizliyi"))
      expect(params).toContain(tokenGroupQuery(group));
    expect(sql).toContain('"daily_briefs"."brief_date" >=');
    expect(sql).toContain('"daily_briefs"."brief_date" <=');
    expect(sql).toContain('"daily_briefs"."brief_date" <');
    expect(sql).toContain('"daily_briefs"."id" <');
    expect(sql).toContain("true");
  });

  it("retains newest-first date ordering and page-size limit in the list query", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/briefs/queries.ts"), "utf8");
    expect(source).toContain("desc(sql`search_score`)");
    expect(source).toContain("desc(dailyBriefs.briefDate), desc(dailyBriefs.id)");
    expect(source).toMatch(/\.limit\(BRIEF_PAGE_SIZE \+ 1\)/u);
  });
});
