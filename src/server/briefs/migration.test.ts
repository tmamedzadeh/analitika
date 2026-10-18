import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/0006_published_briefs.sql", "utf8");

describe("published brief migration", () => {
  it("publishes existing briefs and queues every brief that is not indexed", () => {
    expect(migration).toMatch(/UPDATE daily_briefs[\s\S]+status = 'published'/i);
    expect(migration).toMatch(
      /index_status = CASE WHEN index_status = 'ready' THEN 'ready' ELSE 'queued' END/i,
    );
    expect(migration).toMatch(/published_at = COALESCE\(published_at, updated_at, created_at\)/i);
    expect(migration).toMatch(/CHECK \(status = 'published'\)/i);
  });
});
