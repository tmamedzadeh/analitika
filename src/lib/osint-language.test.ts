import { describe, expect, it } from "vitest";

import {
  detectedPageLanguage,
  originalSourceLanguage,
  originalSourceLanguageLabel,
} from "./osint-language";

describe("original source language metadata", () => {
  it("normalizes supported page language tags and maps them to labels", () => {
    expect(originalSourceLanguage("en-US")).toBe("en");
    expect(originalSourceLanguage("az_AZ")).toBe("az");
    expect(originalSourceLanguageLabel("en-US")).toBe("English");
  });

  it("uses Open Graph locale only when the page language is unavailable or unsupported", () => {
    expect(detectedPageLanguage("fr-FR", "en_US")).toBe("fr");
    expect(detectedPageLanguage("de-DE", "en_US")).toBe("en");
    expect(detectedPageLanguage(undefined, "de_DE")).toBeNull();
  });

  it("does not guess unsupported or missing source languages", () => {
    expect(originalSourceLanguage(undefined)).toBeNull();
    expect(originalSourceLanguage("de")).toBeNull();
    expect(originalSourceLanguageLabel("unknown")).toBeNull();
  });
});
