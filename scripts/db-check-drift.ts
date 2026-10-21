import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as schema from "../src/server/db/schema";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import "../src/server/env";
import { verifyLiveSchema } from "./live-schema";
import postgres from "postgres";

type Snapshot = ReturnType<typeof generateDrizzleJson>;

const root = resolve(import.meta.dirname, "..");
const journal = JSON.parse(await readFile(resolve(root, "drizzle/meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[];
};
const lastEntry = journal.entries.at(-1);
if (!lastEntry) throw new Error("Migration journal is empty.");

const snapshotNumber = String(lastEntry.idx).padStart(4, "0");
const snapshotPath = resolve(root, "drizzle/meta/" + snapshotNumber + "_snapshot.json");
const recorded = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
const current = generateDrizzleJson(schema, recorded.id) as Snapshot;
const migration = await generateMigration(recorded, current);
if (migration.length) throw new Error("Schema drift detected against " + lastEntry.tag + ".");

console.log("Schema matches Drizzle snapshot " + snapshotNumber + ".");

// Verify the actual database through catalogs and empty transaction-local TEMP tables.
const migrationUrl = process.env["DATABASE_URL_MIGRATE"]?.trim();
if (!migrationUrl)
  throw new Error("DATABASE_URL_MIGRATE is required for live schema verification.");
const introspectionClient = postgres(migrationUrl, { max: 1, prepare: false, connect_timeout: 10 });
try {
  const live = await verifyLiveSchema(introspectionClient, current);
  await writeFile("docs/release/LIVE_SCHEMA_DRIFT.json", JSON.stringify(live, null, 2) + "\n");
  if (live.mismatches.length) {
    console.error(JSON.stringify({ liveSchemaDrift: live.mismatches }));
    process.exitCode = 1;
  } else {
    console.log("Live configured database matches the application schema (including RLS).");
  }
} catch (error) {
  console.error(
    JSON.stringify({
      status: "live-introspection-failed",
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await introspectionClient.end({ timeout: 5 });
}
