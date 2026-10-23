import { plainTextDocument } from "@/lib/rich-text";
import { describe, expect, it } from "vitest";

import { createDocumentSchema, documentUploadMatches } from "./documents.functions";
import * as documentFunctions from "./documents.functions";
import { directionIds } from "./directions";

const validDocument = {
  title: "Test document",
  body: "Synthetic document text.",
  bodyRich: plainTextDocument("Synthetic document text."),
  docDate: null,
  direction: "OSINT",
  classification: "open",
  sourceReliability: "F",
  infoCredibility: 6,
  photos: [],
};

describe("document form validation", () => {
  it("does not expose a document direction update mutation", () => {
    expect(documentFunctions).not.toHaveProperty("updateDocumentDirection");
  });

  it("requires a valid intelligence direction", () => {
    expect(createDocumentSchema.safeParse(validDocument).success).toBe(true);
    expect(createDocumentSchema.safeParse({ ...validDocument, direction: undefined }).success).toBe(
      false,
    );
    expect(createDocumentSchema.safeParse({ ...validDocument, direction: "İdarə 3" }).success).toBe(
      false,
    );
    expect(directionIds).toEqual([
      "HUMINT",
      "OSINT",
      "IMINT",
      "SIGINT",
      "CYBINT",
      "GEOINT",
      "MASINT",
      "TECHINT",
      "FININT",
      "TACINT_CI",
    ]);
  });

  it("rejects photos above the configured maximum size", () => {
    expect(
      createDocumentSchema.safeParse({
        ...validDocument,
        photos: [{ name: "large.png", mime: "image/png", size: 10 * 1024 * 1024 + 1 }],
      }).success,
    ).toBe(false);
  });

  it("checks document photo size, declared type, content type, and file signature", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const base = {
      expectedMime: "image/png" as const,
      expectedSize: png.length,
      actualSize: png.length,
      signature: png,
    };
    expect(documentUploadMatches(base)).toBe(true);
    expect(documentUploadMatches({ ...base, actualSize: png.length + 1 })).toBe(false);
    expect(documentUploadMatches({ ...base, actualContentType: "image/jpeg" })).toBe(false);
    expect(
      documentUploadMatches({
        ...base,
        expectedMime: "image/jpeg",
        actualContentType: "image/jpeg",
      }),
    ).toBe(false);
    expect(
      documentUploadMatches({
        ...base,
        expectedSize: 10 * 1024 * 1024 + 1,
        actualSize: 10 * 1024 * 1024 + 1,
      }),
    ).toBe(false);
  });
});
