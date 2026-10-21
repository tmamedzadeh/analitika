import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  DOCUMENT_INDEX_STALE_AFTER_MS,
  documentIndexClaimCondition,
  isValidDocumentEmbeddingBatch,
} from "./process-document";

describe("document indexing embeddings", () => {
  it("accepts complete finite vectors with the schema dimension", () => {
    expect(
      isValidDocumentEmbeddingBatch(
        [
          [0, 0.5],
          [1, -1],
        ],
        2,
        2,
      ),
    ).toBe(true);
  });

  it("rejects partial batches and incompatible dimensions", () => {
    expect(isValidDocumentEmbeddingBatch([[0, 1]], 2, 2)).toBe(false);
    expect(isValidDocumentEmbeddingBatch([[0, 1, 2]], 1, 2)).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite vector entries (%s)",
    (value) => {
      expect(isValidDocumentEmbeddingBatch([[0, value]], 1, 2)).toBe(false);
    },
  );
});

describe("document indexing recovery claim", () => {
  it("allows stale processing rows to be reclaimed after the worker lease expires", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const query = new PgDialect().sqlToQuery(documentIndexClaimCondition(now)!);

    expect(DOCUMENT_INDEX_STALE_AFTER_MS).toBe(6 * 60_000);
    expect(query.sql).toContain('"documents"."status" in');
    expect(query.sql).toContain('"documents"."status" =');
    expect(query.sql).toContain('"documents"."updated_at" <');
    expect(query.params).toContain("2026-10-21T11:54:00.000Z");
  });
});
