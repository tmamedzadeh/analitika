// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { plainTextDocument, projectRichText, type RichDocument } from "@/lib/rich-text";

// Embedded WASM PostgreSQL, memory:// only. No credentials, sockets, external DB or provider.
const database = new PGlite("memory://");
beforeAll(async () => {
  await database.exec(
    "CREATE TABLE documents (id text PRIMARY KEY, body text NOT NULL); CREATE TABLE daily_briefs (id text PRIMARY KEY, body text NOT NULL);",
  );
  await database.exec(readFileSync(resolve("drizzle/0025_rich_text_documents.sql"), "utf8"));
}, 30_000);
afterAll(async () => {
  await database.close();
});

describe("prepared rich-text migration in isolated memory", () => {
  it("matches the server projection for nested structures, blank blocks, breaks and Unicode", async () => {
    const doc: RichDocument = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Əİ 🌍 e\u0301" }],
        },
        { type: "paragraph" },
        {
          type: "orderedList",
          attrs: { start: 5 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: " Bir\t" },
                    { type: "hardBreak" },
                    { type: "text", text: "İki ", marks: [{ type: "bold" }] },
                  ],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "Alt bənd" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        ...Array.from({ length: 15 }, (_, i) => plainTextDocument(`Abzas ${i}`).content[0]!),
      ],
    };
    const result = await database.query<{ body: string }>(
      "SELECT public.rich_text_plain($1::jsonb) AS body",
      [JSON.stringify(doc)],
    );
    expect(result.rows[0]?.body).toBe(projectRichText(doc).text);
  });
  it.each(["documents", "daily_briefs"])(
    "enforces atomic rich/text consistency for %s",
    async (table) => {
      const doc = plainTextDocument("Sintetik mətn 🌍");
      const body = projectRichText(doc).text;
      await database.query(
        `INSERT INTO ${table} (id, body, body_rich) VALUES ($1, $2, $3::jsonb)`,
        [table, body, JSON.stringify(doc)],
      );
      await expect(
        database.query(`UPDATE ${table} SET body = $1 WHERE id = $2`, ["Divergence", table]),
      ).rejects.toThrow(/rich_projection_check/);
      await expect(
        database.query(`UPDATE ${table} SET body_rich = NULL WHERE id = $1`, [table]),
      ).rejects.toThrow(/not-null/);
      const changed = plainTextDocument("Dəyişdirilmiş mətn");
      await database.query(`UPDATE ${table} SET body = $1, body_rich = $2::jsonb WHERE id = $3`, [
        projectRichText(changed).text,
        JSON.stringify(changed),
        table,
      ]);
      const result = await database.query<{ body: string; body_rich: RichDocument }>(
        `SELECT body, body_rich FROM ${table} WHERE id = $1`,
        [table],
      );
      expect(result.rows[0]?.body).toBe(projectRichText(result.rows[0]!.body_rich).text);
    },
  );
  it("projects large documents in the same tree order as JavaScript", async () => {
    const doc = plainTextDocument(
      Array.from({ length: 287 }, (_, i) => `Abzas ${i}. ${"ə ".repeat(200)}`).join("\n\n"),
    );
    const result = await database.query<{ body: string }>(
      "SELECT public.rich_text_plain($1::jsonb) AS body",
      [JSON.stringify(doc)],
    );
    expect(result.rows[0]?.body).toBe(projectRichText(doc).text);
  });
});
