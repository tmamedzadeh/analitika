import { describe, expect, it } from "vitest";

import {
  briefExcerpt,
  briefStatuses,
  briefSearchLabel,
  briefRouteForSearchSource,
  formatBriefEmbeddingText,
  getBakuDate,
  getWeekStartDate,
  imageMimeFromSignature,
  inspectBriefPhoto,
  photoError,
} from "./briefs";

describe("daily brief validation and dates", () => {
  it("calculates today and week boundaries in Asia/Baku calendar dates", () => {
    expect(getBakuDate(new Date("2026-10-17T20:30:00.000Z"))).toBe("2026-10-18");
    expect(getWeekStartDate("2026-10-18")).toBe("2026-10-12");
  });

  it("turns markdown into a short plain-text excerpt", () => {
    expect(
      briefExcerpt(
        "# Başlıq\nMətn **vurğulu** və [link](https://example.com).\n\n| a | b |\n|---|---|\n|1|2|",
      ),
    ).toBe("Başlıq Mətn vurğulu və link.");
    expect(briefExcerpt("söz ".repeat(80), 20)).toHaveLength(20);
  });
});

describe("brief photo safety", () => {
  it("enforces photo count and size before signature inspection", () => {
    const jpeg = { type: "image/jpeg", size: 120 };
    expect(photoError(Array(10).fill(jpeg))).toBeNull();
    expect(photoError(Array(11).fill(jpeg))).not.toBeNull();
    expect(photoError([{ size: 120 }])).toBeNull();
    expect(photoError([{ size: 10 * 1024 * 1024 + 1 }])).not.toBeNull();
  });

  it("detects JPEG, PNG, and WebP from their file signatures", () => {
    expect(imageMimeFromSignature(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(
      imageMimeFromSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(imageMimeFromSignature(webp)).toBe("image/webp");
    expect(imageMimeFromSignature(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
  });

  it("detects the photo MIME from bytes instead of filename or browser MIME", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = {
      name: "sample.jpg",
      type: "image/gif",
      size: bytes.byteLength,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
    } as File;
    expect(await inspectBriefPhoto(file)).toEqual({ mime: "image/png", size: bytes.byteLength });
  });

  it("rejects unsupported signatures regardless of the filename", async () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38]);
    const file = {
      name: "allowed.png",
      type: "image/png",
      size: bytes.byteLength,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
    } as File;
    expect(await inspectBriefPhoto(file)).toBeNull();
  });
});

describe("brief indexing and search mapping", () => {
  it("allows only published briefs", () => {
    expect(briefStatuses).toEqual(["published"]);
  });

  it("prefixes brief embeddings with the title and date", () => {
    expect(formatBriefEmbeddingText("Nəqliyyat", "2026-10-18", "Yük həcmi artıb.")).toBe(
      "Nəqliyyat / 2026-10-18\nYük həcmi artıb.",
    );
  });

  it("uses the brief route and chunk query for indexed search results", () => {
    expect(briefSearchLabel("2026-10-18")).toBe("Gündəlik xülasə · 2026-10-18");
    expect(
      briefRouteForSearchSource({
        sourceKind: "brief",
        documentId: null,
        briefId: "brief/id",
        chunkId: "chunk id",
      }),
    ).toBe("/brifler/brief%2Fid?chunk=chunk%20id");
    expect(
      briefRouteForSearchSource({
        sourceKind: "document",
        documentId: "doc/id",
        briefId: null,
        chunkId: "chunk id",
      }),
    ).toBe("/senedler/doc%2Fid?chunk=chunk%20id");
  });
});
