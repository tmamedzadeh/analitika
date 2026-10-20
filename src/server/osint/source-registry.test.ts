import { describe, expect, it } from "vitest";

import { registryDomains, registryForLanguage, sourceRegistryEntry } from "./source-registry";

describe("descriptive source registry", () => {
  it("contains seed reference sources with source types and no credibility ratings", () => {
    const entries = [
      sourceRegistryEntry("www.csis.org", "en"),
      sourceRegistryEntry("rusi.org", "en"),
      sourceRegistryEntry("missilethreat.csis.org", "en"),
      sourceRegistryEntry("themoscowtimes.com", "en"),
    ];
    expect(entries.every(Boolean)).toBe(true);
    expect(entries.map((entry) => entry?.type)).toEqual([
      "think_tank",
      "think_tank",
      "think_tank",
      "independent_media",
    ]);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("credibility");
      expect(entry).not.toHaveProperty("score");
    }
  });

  it("keeps registry coverage available for each selected language", () => {
    for (const language of ["fa", "hy", "ru", "zh", "en", "fr", "ka", "az"] as const) {
      expect(registryForLanguage(language).length).toBeGreaterThan(0);
      expect(registryDomains(language)).toEqual(
        registryForLanguage(language).map((entry) => entry.domain),
      );
    }
  });

  it("includes the requested Azerbaijani outlets and public institutions", () => {
    const expected = new Map([
      ["apa.az", "agency"],
      ["report.az", "domestic_media"],
      ["trend.az", "agency"],
      ["azertag.az", "agency"],
      ["1news.az", "domestic_media"],
      ["musavat.com", "domestic_media"],
      ["turan.az", "agency"],
      ["azadliq.org", "international_media"],
      ["meydan.tv", "independent_media"],
      ["president.az", "official"],
      ["mfa.gov.az", "official"],
      ["mod.gov.az", "official"],
      ["aircenter.az", "think_tank"],
    ]);
    for (const [domain, type] of expected) {
      expect(sourceRegistryEntry(domain, "az")?.type).toBe(type);
    }
  });

  it("does not invent metadata for unregistered domains", () => {
    expect(sourceRegistryEntry("unlisted.example", "ka")).toBeUndefined();
  });
});
