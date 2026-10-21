import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { BRIEF_INDEX_STALE_AFTER_MS, briefIndexClaimCondition } from "./index-brief";

const dialect = new PgDialect();
const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("brief index recovery policy", () => {
  it("reclaims stale processing rows and keeps fresh processing rows leased", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const query = dialect.sqlToQuery(briefIndexClaimCondition(now)!);
    expect(BRIEF_INDEX_STALE_AFTER_MS).toBe(15 * 60_000);
    expect(query.sql).toContain('"daily_briefs"."index_status" =');
    expect(query.sql).toContain('"daily_briefs"."updated_at" <');
    expect(query.params).toContain("2026-10-21T11:45:00.000Z");
    expect(query.params).toContain("queued");
  });

  it("prepares all vectors before replacing the committed index transactionally", () => {
    const job = source("src/server/jobs/index-brief.ts");
    expect(job.indexOf("embeddings.embedDocuments")).toBeLessThan(
      job.indexOf(
        "await transaction.delete(chunks)",
        job.indexOf("await db.transaction(async (transaction)", job.indexOf("const embeddings")),
      ),
    );
    expect(job).toContain("transaction.insert(chunks).values(prepared)");
    expect(job).toContain('indexStatus: "ready"');
    expect(job).toContain('eq(dailyBriefs.indexStatus, "processing")');
    expect(job).toContain("vector.some((value) => !Number.isFinite(value))");
  });

  it("recovers stale state and bounds retries for failed indexes", () => {
    const functions = source("src/server/jobs/recover-indexes.ts");
    expect(functions).toContain("recoveryAttempts");
    expect(functions).toContain("MAX_RECOVERY_ATTEMPTS = 5");
    expect(functions).toContain("attempts >= MAX_RECOVERY_ATTEMPTS");
    expect(functions).toContain("BRIEF_INDEX_STALE_AFTER_MS");
  });
});
