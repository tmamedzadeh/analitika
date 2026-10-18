import { describe, expect, it } from "vitest";

import { departments } from "./departments";
import {
  infoRequestInputSchema,
  requestMaxAttachmentSize,
  requestMaxAttachments,
  requestMimeFromName,
  requestMimeFromSignature,
  requestUploadMatches,
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

  it("detects request attachment types from file signatures", () => {
    expect(requestMimeFromSignature(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(requestMimeFromSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(requestMimeFromSignature(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(
      requestMimeFromSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(requestMimeFromSignature(webp)).toBe("image/webp");
    expect(requestMimeFromSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
  });

  it("checks request upload size, content type, and detected signature", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7");
    expect(
      requestUploadMatches({
        expectedMime: "application/pdf",
        expectedSize: pdf.length,
        actualSize: pdf.length,
        actualContentType: "application/pdf",
        signature: pdf,
      }),
    ).toBe(true);
    expect(
      requestUploadMatches({
        expectedMime: "application/pdf",
        expectedSize: requestMaxAttachmentSize + 1,
        actualSize: requestMaxAttachmentSize + 1,
        signature: pdf,
      }),
    ).toBe(false);
    expect(
      requestUploadMatches({
        expectedMime: "application/pdf",
        expectedSize: pdf.length,
        actualSize: pdf.length,
        actualContentType: "image/png",
        signature: pdf,
      }),
    ).toBe(false);
  });
});
