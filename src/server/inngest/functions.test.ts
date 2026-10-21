import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BRIEF_INDEX_STALE_AFTER_MS, briefIndexClaimCondition } from "../jobs/index-brief";

import { functions, HOUSEKEEPING_CRON } from "./functions";

function cronOf(id: string): string | undefined {
  const fn = functions.find((item) => item.opts.id === id);
  const triggers: unknown[] = fn?.opts.triggers ?? [];
  const trigger = triggers.find(
    (item): item is { cron: string } => typeof item === "object" && item !== null && "cron" in item,
  );
  return trigger?.cron;
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("housekeeping cron schedules", () => {
  it("requeues stale document indexes and pending briefs every 15 minutes", () => {
    expect(HOUSEKEEPING_CRON).toBe("*/15 * * * *");
    expect(cronOf("requeue-stale-document-indexes")).toBe("*/15 * * * *");
    expect(cronOf("requeue-pending-briefs")).toBe("*/15 * * * *");
  });

  it("keeps the daily cleanup jobs untouched", () => {
    expect(cronOf("cleanup-orphaned-uploads")).toBe("0 2 * * *");
    expect(cronOf("cleanup-analytics-history")).toBe("0 2 * * *");
  });

  it("registers event-driven functions without a cron trigger", () => {
    expect(cronOf("process-document")).toBeUndefined();
    expect(cronOf("index-brief")).toBeUndefined();
  });
});

describe("background indexing events", () => {
  it("queues brief indexing directly and leaves a durable queued state if send fails", () => {
    const briefs = source("src/server/briefs/mutations.ts");
    expect(briefs).toMatch(/inngest\.send\(briefIndexingRequested\.create\(/);
    expect(briefs).toMatch(/catch \{[\s\S]*?queueFailed = true;[\s\S]*?indexStatus: "queued"/u);
  });

  it("recovers stale processing and bounded failed brief indexes", () => {
    const functionsSource = source("src/server/jobs/recover-indexes.ts");
    expect(BRIEF_INDEX_STALE_AFTER_MS).toBe(15 * 60_000);
    expect(functionsSource).toContain("BRIEF_INDEX_STALE_AFTER_MS");
    expect(functionsSource).toContain("recoveryAttempts");
    expect(functionsSource).toContain("MAX_RECOVERY_ATTEMPTS = 5");
    expect(functionsSource).toContain("attempts >= MAX_RECOVERY_ATTEMPTS");
  });

  it("marks a stale processing brief eligible for atomic reclaim", () => {
    const query = new PgDialect().sqlToQuery(
      briefIndexClaimCondition(new Date("2026-10-21T12:00:00.000Z"))!,
    );
    expect(query.sql).toContain('"daily_briefs"."index_status" =');
    expect(query.sql).toContain('"daily_briefs"."updated_at" <');
    expect(query.params).toContain("2026-10-21T11:45:00.000Z");
    expect(query.params).toContain("queued");
  });

  it("prepares embeddings before atomic committed-index replacement", () => {
    const job = source("src/server/jobs/index-brief.ts");
    expect(job.indexOf("embeddings.embedDocuments")).toBeLessThan(
      job.indexOf(
        "await transaction.delete(chunks)",
        job.indexOf("db.transaction(async (transaction)", job.indexOf("const prepared")),
      ),
    );
    expect(job).toContain("db.transaction(async (transaction)");
    expect(job).toContain('indexStatus: "ready"');
    expect(job).toContain('eq(dailyBriefs.indexStatus, "processing")');
  });
});
