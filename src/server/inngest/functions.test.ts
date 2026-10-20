import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { functions, HOUSEKEEPING_CRON } from "./functions";

function cronOf(id: string): string | undefined {
  const fn = functions.find((item) => item.opts.id === id);
  const trigger = (fn?.opts.triggers ?? []).find(
    (item): item is { cron: string } => typeof item === "object" && item !== null && "cron" in item,
  );
  return trigger?.cron;
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("housekeeping cron schedules", () => {
  it("runs stale-run closing and brief requeue every 15 minutes", () => {
    expect(HOUSEKEEPING_CRON).toBe("*/15 * * * *");
    expect(cronOf("close-stale-osint-runs")).toBe("*/15 * * * *");
    expect(cronOf("requeue-pending-briefs")).toBe("*/15 * * * *");
  });

  it("keeps the daily cleanup jobs untouched", () => {
    expect(cronOf("cleanup-orphaned-uploads")).toBe("0 2 * * *");
    expect(cronOf("cleanup-analytics-history")).toBe("0 2 * * *");
  });

  it("registers event-driven functions without a cron trigger", () => {
    expect(cronOf("run-osint")).toBeUndefined();
    expect(cronOf("retry-osint-summary")).toBeUndefined();
    expect(cronOf("index-brief")).toBeUndefined();
  });
});

describe("independence from the cron backstops", () => {
  const osint = source("src/lib/osint.functions.ts");

  it("starts an OSINT run by sending the event directly", () => {
    expect(osint).toMatch(/inngest\.send\(osintRunRequested\.create\(\{ runId \}\)\)/);
  });

  it("closes stale OSINT runs on list and read, not only from the cron", () => {
    const list = osint.slice(osint.indexOf("export const listOsintRuns"));
    const read = osint.slice(osint.indexOf("export const getOsintRun"));
    expect(list.slice(0, list.indexOf("export const getOsintRun"))).toContain(
      "await markStaleOsintRuns()",
    );
    expect(read.slice(0, read.indexOf("export const retryOsintSummary"))).toContain(
      "await markStaleOsintRuns()",
    );
  });

  it("queues brief indexing directly after saving a brief", () => {
    const briefs = source("src/server/briefs/mutations.ts");
    expect(briefs).toMatch(/inngest\.send\(briefIndexingRequested\.create\(/);
  });
});
