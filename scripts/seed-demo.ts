/** This project has one protected database. Destructive demo seeding is disabled on every target. */
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";

export function parseMode(args: string[] = process.argv.slice(2)): "dry-run" {
  if (args.includes("--reset-and-seed")) {
    throw new Error("Destructive reset-and-seed is disabled for the configured project database.");
  }
  if (args.some((arg) => arg !== "--dry-run")) throw new Error("Unsupported seed argument.");
  return "dry-run";
}

/** Returns aggregate fixture counts only; archived material must never be sent to an AI provider. */
export async function archivedSeedCounts(): Promise<{ documents: number; briefs: number }> {
  const dataset = JSON.parse(
    await readFile(
      new NodeURL("../fixtures/seed/zirve_military_seed_data_2026-10-18.json", import.meta.url),
      "utf8",
    ),
  ) as {
    documents?: unknown[];
    dailyBriefs?: unknown[];
  };
  if (
    !Array.isArray(dataset.documents) ||
    !Array.isArray(dataset.dailyBriefs) ||
    dataset.documents.length !== 10 ||
    dataset.dailyBriefs.length !== 10
  ) {
    throw new Error("Expected the archived 10-document/10-brief dataset.");
  }
  return { documents: dataset.documents.length, briefs: dataset.dailyBriefs.length };
}

async function main(): Promise<void> {
  const mode = parseMode();
  await archivedSeedCounts();
  const counts = await getDb().execute(sql`select
    (select count(*)::int from documents) as documents,
    (select count(*)::int from daily_briefs) as briefs,
    (select count(*)::int from chunks) as chunks,
    (select count(*)::int from attachments) as document_attachments,
    (select count(*)::int from brief_attachments) as brief_attachments`);
  console.log(
    JSON.stringify(
      { mode, destructiveReset: "disabled", counts, writes: 0, providerCalls: 0 },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1]?.replace(/\\/gu, "/").endsWith("scripts/seed-demo.ts");
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "failed",
        errorType: error instanceof Error ? error.name : "unknown",
      }),
    );
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
