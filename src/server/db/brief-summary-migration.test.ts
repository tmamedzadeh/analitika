// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const database = new PGlite("memory://");
beforeAll(async () => {
  await database.exec(`CREATE TABLE daily_briefs (
    id text PRIMARY KEY, body text NOT NULL, body_rich jsonb NOT NULL, index_status text NOT NULL
  );
  INSERT INTO daily_briefs VALUES ('synthetic', 'Original body', '{"type":"doc"}', 'ready');`);
  await database.exec(readFileSync("drizzle/0026_brief_summary.sql", "utf8"));
}, 30_000);
afterAll(async () => {
  await database.close();
});

describe("nullable summary migration", () => {
  it("preserves the existing row and initializes summary as NULL", async () => {
    const result = await database.query("SELECT * FROM daily_briefs");
    expect(result.rows).toEqual([
      {
        id: "synthetic",
        body: "Original body",
        body_rich: { type: "doc" },
        index_status: "ready",
        summary: null,
      },
    ]);
  });
  it("accepts 400 characters and NULL while rejecting longer summaries", async () => {
    await database.query("UPDATE daily_briefs SET summary = $1", ["ə".repeat(400)]);
    await expect(
      database.query("UPDATE daily_briefs SET summary = $1", ["ə".repeat(401)]),
    ).rejects.toThrow(/summary_length_check/);
    await database.query("UPDATE daily_briefs SET summary = NULL");
    const result = await database.query("SELECT body, body_rich, index_status FROM daily_briefs");
    expect(result.rows).toEqual([
      { body: "Original body", body_rich: { type: "doc" }, index_status: "ready" },
    ]);
  });
});
