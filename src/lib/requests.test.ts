import { describe, expect, it } from "vitest";

import { departments } from "./departments";
import {
  infoRequestInputSchema,
  requestMaxAttachmentSize,
  requestMaxAttachments,
  requestMimeFromName,
} from "./requests";

const validRequest = {
  department: departments[0].id,
  requestDate: "2026-10-17",
  urgency: "normal",
  purpose: "Məlumatın hazırlanması üçün",
  details: "Su təchizatı barədə məlumat lazımdır.",
  sourceReliability: "F",
  infoCredibility: 6,
  note: "",
  attachments: [],
};

describe("information request validation", () => {
  it("accepts valid request fields and default reliability ratings", () => {
    const result = infoRequestInputSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeNull();
  });

  it("rejects malformed dates and unknown departments", () => {
    expect(
      infoRequestInputSchema.safeParse({ ...validRequest, requestDate: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      infoRequestInputSchema.safeParse({ ...validRequest, department: "Unknown" }).success,
    ).toBe(false);
  });

  it("accepts supported file extensions and maps them to canonical MIME types", () => {
    expect(requestMimeFromName("memo.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const result = infoRequestInputSchema.safeParse({
      ...validRequest,
      attachments: [{ name: "proof.png", mime: "image/png", size: 1024 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched file types, oversized files, and more than ten files", () => {
    expect(
      infoRequestInputSchema.safeParse({
        ...validRequest,
        attachments: [{ name: "proof.png", mime: "application/pdf", size: 1024 }],
      }).success,
    ).toBe(false);
    expect(
      infoRequestInputSchema.safeParse({
        ...validRequest,
        attachments: [
          { name: "proof.pdf", mime: "application/pdf", size: requestMaxAttachmentSize + 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      infoRequestInputSchema.safeParse({
        ...validRequest,
        attachments: Array.from({ length: requestMaxAttachments + 1 }, (_, index) => ({
          name: `proof-${index}.png`,
          mime: "image/png",
          size: 1024,
        })),
      }).success,
    ).toBe(false);
  });
});
