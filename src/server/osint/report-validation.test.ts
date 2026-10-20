import { describe, expect, it } from "vitest";

import type { StoredStructuredReport } from "./reports";
import {
  claimSupportedBy,
  fallbackBluf,
  finalizeReport,
  reportableRecords,
  splitSentences,
  supportingSourceNumbers,
  validateBluf,
  validateFindings,
  validateReport,
  type ReportRecord,
} from "./report-validation";

const defense: ReportRecord = {
  number: 1,
  title: "Bakı və Ankara müdafiə sazişi imzalayıb",
  summary:
    "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Saziş 2025 ildə qüvvəyə minib.",
  claims: ["Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb"],
  entities: ["Azərbaycan", "Türkiyə", "Bakı"],
  eventDate: "2025-03-10",
  publicationDate: "2025-03-11",
  relevance: "direct",
};

const regional: ReportRecord = {
  number: 2,
  title: "Qafqazda regional təhlükəsizlik müzakirələri",
  summary:
    "Regional təhlükəsizlik ekspertləri Tbilisidə 2024 ildə Qafqaz üzrə nəqliyyat dəhlizlərini müzakirə ediblər.",
  claims: ["Ekspertlər Qafqaz nəqliyyat dəhlizlərini müzakirə ediblər"],
  entities: ["Tbilisi", "Qafqaz"],
  eventDate: null,
  publicationDate: "2024-06-01",
  relevance: "tangential",
};

const offtopic: ReportRecord = {
  number: 3,
  title: "Futbol çempionatının yekunları",
  summary: "Yerli klublar mövsümün son turunda qələbə qazanıb.",
  claims: [],
  entities: [],
  eventDate: null,
  publicationDate: null,
  relevance: "offtopic",
};

const records = [defense, regional, offtopic];

const goodBluf =
  "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Saziş 2025 ildə imzalanıb və müdafiə sənayesini əhatə edir.";

function report(overrides: Partial<StoredStructuredReport> = {}): StoredStructuredReport {
  return {
    bluf: goodBluf,
    blufSourceNumbers: [1],
    keyFindings: [],
    timeline: [],
    perspectives: [],
    disagreements: [],
    entities: [],
    gaps: [],
    watch: [],
    caveats: [],
    ...overrides,
  };
}

describe("splitSentences", () => {
  it("ignores citations and short abbreviations when splitting", () => {
    expect(splitSentences("Birinci cümlə var [1]. İkinci cümlə var [2, 3]! Üçüncü.")).toEqual([
      "Birinci cümlə var.",
      "İkinci cümlə var!",
      "Üçüncü.",
    ]);
    expect(splitSentences("O, b. Əliyev bildirib. Sonra getdi.")).toHaveLength(2);
  });
});

describe("validateBluf", () => {
  it("accepts two concrete sentences linked to a cited direct source", () => {
    expect(validateBluf(goodBluf, [1], records)).toEqual({
      valid: true,
      sourceNumbers: [1],
      reasons: [],
    });
  });

  it("rejects a BLUF without any existing citation, even when numbers are given", () => {
    expect(validateBluf(goodBluf, [], records).reasons).toEqual(["no_citations"]);
    expect(validateBluf(goodBluf, [42], records)).toEqual({
      valid: false,
      sourceNumbers: [],
      reasons: ["no_citations"],
    });
  });

  it("requires two or three sentences", () => {
    const one = "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb.";
    expect(validateBluf(one, [1], records).reasons).toContain("sentence_count");
    const four = [goodBluf, "Türkiyə 2025 ildə Bakıda hərbi sazişi imzalayıb.", one].join(" ");
    expect(validateBluf(four, [1], records).reasons).toContain("sentence_count");
  });

  it("rejects vague generalities and claims that the cited summary does not support", () => {
    const vague =
      "Müxtəlif mənbələrdə müxtəlif məlumatlar dərc olunub. Bu mövzuda bir sıra xəbərlər yayılıb.";
    const result = validateBluf(vague, [1], records);
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["not_concrete", "unsupported"]));
    expect(result.sourceNumbers).toEqual([]);
  });

  it("rejects a concrete sentence whose facts are absent from the cited source", () => {
    const invented =
      "Rusiya və Ukrayna prezidentləri 2030 ildə Moskvada sülh sazişi imzalayıb. Saziş 2030 ildə qüvvəyə minib.";
    const result = validateBluf(invented, [1], records);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("unsupported");
  });

  it("treats a number that is not in the cited records as unsupported", () => {
    const wrongNumber =
      "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Saziş 1999 ildə imzalanıb və müdafiə sahəsini əhatə edir.";
    expect(validateBluf(wrongNumber, [1], records).reasons).toContain("unsupported");
  });

  it("needs a direct source when a direct record exists", () => {
    const tangential =
      "Regional təhlükəsizlik ekspertləri Tbilisidə Qafqaz nəqliyyat dəhlizlərini müzakirə ediblər. Müzakirə 2024 ildə keçirilib və regional təhlükəsizliyə həsr olunub.";
    const result = validateBluf(tangential, [2], records);
    expect(result.sourceNumbers).toEqual([2]);
    expect(result.reasons).toEqual(["no_direct_source"]);
    expect(result.valid).toBe(false);
    expect(validateBluf(tangential, [2], [regional]).valid).toBe(true);
  });

  it("returns only the cited sources that actually support the text", () => {
    const result = validateBluf(goodBluf, [1, 2], records);
    expect(result.valid).toBe(true);
    expect(result.sourceNumbers).toEqual([1]);
  });
});

describe("claim to source linkage", () => {
  it("keeps only the cited sources that support the claim", () => {
    const byNumber = new Map(records.map((record) => [record.number, record]));
    expect(
      supportingSourceNumbers(
        "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb",
        [1, 2, 99],
        byNumber,
      ),
    ).toEqual([1]);
    expect(
      supportingSourceNumbers("Rusiya Moskvada 2030 ildə sazişi ləğv edib", [1, 2], byNumber),
    ).toEqual([]);
  });

  it("is a content-overlap heuristic: a numeral that is absent breaks support", () => {
    expect(claimSupportedBy("Saziş 2025 ildə qüvvəyə minib", [defense])).toBe(true);
    expect(claimSupportedBy("Saziş 2031 ildə qüvvəyə minib", [defense])).toBe(false);
    expect(claimSupportedBy("Saziş qüvvəyə minib", [])).toBe(false);
  });

  it("separates supported findings from weak ones and never drops a weak one silently", () => {
    const result = validateFindings(
      [
        { text: "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb.", sourceNumbers: [1, 2] },
        { text: "Rusiya Moskvada 2030 ildə sazişi ləğv edib.", sourceNumbers: [1] },
        { text: "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb.", sourceNumbers: [77] },
      ],
      records,
    );
    expect(result.supported).toEqual([
      { text: "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb.", sourceNumbers: [1] },
    ]);
    expect(result.weak.map((item) => item.text)).toEqual([
      "Rusiya Moskvada 2030 ildə sazişi ləğv edib.",
      "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb.",
    ]);
  });
});

describe("relevance handling", () => {
  it("excludes off-topic records from synthesis input but keeps tangential ones", () => {
    expect(reportableRecords(records).map((record) => record.number)).toEqual([1, 2]);
  });

  it("does not let an off-topic source support a finding when it is not passed in", () => {
    const result = validateFindings(
      [{ text: "Yerli klublar mövsümün son turunda qələbə qazanıb.", sourceNumbers: [3] }],
      reportableRecords(records),
    );
    expect(result.supported).toEqual([]);
    expect(result.weak).toHaveLength(1);
  });
});

describe("fallback BLUF", () => {
  const findings = [
    {
      text: "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Müdafiə sazişi 2025 ildə qüvvəyə minib.",
      sourceNumbers: [1],
    },
    {
      text: "Regional təhlükəsizlik ekspertləri Tbilisidə 2024 ildə görüşüblər. Ekspertlər Qafqaz nəqliyyat dəhlizlərini müzakirə ediblər.",
      sourceNumbers: [2],
    },
  ];

  it("builds from validated findings, preferring direct sources and at most three sentences", () => {
    const result = fallbackBluf(findings, records);
    expect(result?.bluf).toBe(
      "Azərbaycan və Türkiyə müdafiə nazirləri Bakıda hərbi əməkdaşlıq sazişi imzalayıb. Müdafiə sazişi 2025 ildə qüvvəyə minib.",
    );
    expect(result?.sourceNumbers).toEqual([1]);
  });

  it("returns no fallback when one validated claim cannot support a two-sentence BLUF", () => {
    const result = fallbackBluf(
      [{ text: "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb.", sourceNumbers: [1] }],
      [defense],
    );
    expect(result).toBeNull();
  });

  it("uses tangential findings when no direct source exists", () => {
    const result = fallbackBluf([findings[1]!], [regional]);
    expect(result).toEqual({
      bluf: "Regional təhlükəsizlik ekspertləri Tbilisidə 2024 ildə görüşüblər. Ekspertlər Qafqaz nəqliyyat dəhlizlərini müzakirə ediblər.",
      sourceNumbers: [2],
    });
  });

  it("returns null without findings", () => {
    expect(fallbackBluf([], records)).toBeNull();
  });
});

describe("validateReport and finalizeReport", () => {
  const supportedFinding = {
    text: "Azərbaycan və Türkiyə hərbi əməkdaşlıq sazişi imzalayıb. Müdafiə sazişi 2025 ildə qüvvəyə minib.",
    sourceNumbers: [1, 2],
  };
  const weakFinding = { text: "Rusiya Moskvada 2030 ildə sazişi ləğv edib.", sourceNumbers: [1] };

  it("keeps a valid BLUF, narrows citations and records weak findings", () => {
    const validated = validateReport(
      report({ blufSourceNumbers: [1, 2], keyFindings: [supportedFinding, weakFinding] }),
      records,
    );
    expect(validated.bluf.valid).toBe(true);
    expect(validated.report.blufSourceNumbers).toEqual([1]);
    expect(validated.report.keyFindings).toEqual([{ ...supportedFinding, sourceNumbers: [1] }]);
    expect(validated.report.weakFindings).toEqual([{ text: weakFinding.text }]);
    expect(validated.supportedFindings).toBe(1);
    expect(validated.weakFindings).toBe(1);
    expect(finalizeReport(validated, records)).toEqual({
      report: validated.report,
      usedFallback: false,
    });
  });

  it("replaces an invalid BLUF with a fallback built only from validated findings", () => {
    const validated = validateReport(
      report({
        bluf: "Müxtəlif mənbələrdə müxtəlif məlumatlar dərc olunub. Bu mövzuda xəbərlər yayılıb.",
        keyFindings: [supportedFinding, weakFinding],
      }),
      records,
    );
    expect(validated.bluf.valid).toBe(false);
    const finalized = finalizeReport(validated, records);
    expect(finalized?.usedFallback).toBe(true);
    expect(finalized?.report.bluf).toBe(supportedFinding.text);
    expect(finalized?.report.blufSourceNumbers).toEqual([1]);
    expect(finalized?.report.bluf).not.toContain("Rusiya");
    expect(finalized?.report.weakFindings).toHaveLength(1);
  });

  it("returns null when the BLUF is invalid and no finding survived validation", () => {
    const validated = validateReport(
      report({ bluf: "Mənbələr müxtəlifdir.", keyFindings: [weakFinding] }),
      records,
    );
    expect(finalizeReport(validated, records)).toBeNull();
  });
});
