import { describe, expect, it } from "vitest";

import { createDocumentSchema } from "./documents.functions";

const validDocument = {
  title: "Test document",
  body: "Synthetic document text.",
  docDate: null,
  tags: [],
  department: "d3",
  classification: "open",
  sourceReliability: "F",
  infoCredibility: 6,
  photos: [],
};

describe("document form validation", () => {
  it("requires a valid department ID", () => {
    expect(createDocumentSchema.safeParse(validDocument).success).toBe(true);
    expect(
      createDocumentSchema.safeParse({ ...validDocument, department: undefined }).success,
    ).toBe(false);
    expect(
      createDocumentSchema.safeParse({ ...validDocument, department: "İdarə 3" }).success,
    ).toBe(false);
  });
});
