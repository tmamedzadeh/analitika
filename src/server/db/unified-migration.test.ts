// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const expand = readFileSync("drizzle/0027_unified_expand.sql", "utf8");
const contract = readFileSync("drizzle/0028_unified_contract.sql", "utf8");
async function database(classification = "open") {
  const db = new PGlite("memory://");
  await db.exec(`CREATE TABLE daily_briefs (id text primary key, classification text NOT NULL DEFAULT 'open', CONSTRAINT daily_briefs_classification_check CHECK (classification IN ('open','secret','top_secret','special')));
    CREATE TABLE documents (id text primary key, classification text DEFAULT 'secret', source_reliability char(1) NOT NULL DEFAULT 'F', info_credibility smallint NOT NULL DEFAULT 6, CONSTRAINT documents_source_reliability_check CHECK (source_reliability IN ('A','B','C','D','E','F')), CONSTRAINT documents_info_credibility_check CHECK (info_credibility BETWEEN 1 AND 6));
    CREATE TABLE attachments (id text); CREATE TABLE brief_attachments (id text);
    ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;
    INSERT INTO documents(id) VALUES ('legacy');
    INSERT INTO documents VALUES ('rated', 'special', 'D', 4);`);
  await db.query("INSERT INTO daily_briefs VALUES ('brief', $1)", [classification]);
  return db;
}
describe("expand/deploy/contract migration safety in embedded PostgreSQL", () => {
  it("preserves unrated meaning, graded records, document classification and RLS", async () => {
    const db = await database();
    try {
      await db.exec(expand);
      await expect(
        db.query("INSERT INTO daily_briefs VALUES ('blocked', 'secret')"),
      ).rejects.toThrow(/daily_briefs_open_only/);
      // Old UI may still send legacy values during the expand/deploy overlap.
      await db.exec("INSERT INTO documents VALUES ('overlap', 'open', 'F', 6)");
      await db.exec(contract);
      expect((await db.query("SELECT * FROM documents WHERE id='legacy'")).rows[0]).toMatchObject({
        source_reliability: null,
        info_credibility: null,
        classification: "secret",
      });
      expect((await db.query("SELECT * FROM documents WHERE id='rated'")).rows[0]).toMatchObject({
        source_reliability: "D",
        info_credibility: 4,
        classification: "special",
      });
      await expect(db.exec("INSERT INTO documents VALUES ('bad','open','F',6)")).rejects.toThrow();
      expect((await db.query("SELECT * FROM daily_briefs")).rows).toEqual([{ id: "brief" }]);
      expect(
        (await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='daily_briefs'"))
          .rows[0],
      ).toEqual({ relrowsecurity: true });
      const defaults = await db.query(
        "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='documents' AND column_name IN ('source_reliability','info_credibility')",
      );
      expect(defaults.rows).toEqual([
        { column_default: null, is_nullable: "YES" },
        { column_default: null, is_nullable: "YES" },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);
  it.each(["secret", "top_secret", "special"])(
    "stops before changing %s brief data",
    async (classification) => {
      const db = await database(classification);
      try {
        await expect(db.exec(expand)).rejects.toThrow(/Non-open bulletins/);
        expect((await db.query("SELECT classification FROM daily_briefs")).rows).toEqual([
          { classification },
        ]);
        expect(
          (await db.query("SELECT source_reliability FROM documents WHERE id='legacy'")).rows,
        ).toEqual([{ source_reliability: "F" }]);
      } finally {
        await db.close();
      }
    },
    30_000,
  );
});
