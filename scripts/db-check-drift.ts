import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as schema from "../src/server/db/schema";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

type Snapshot = {
  id: string;
  prevId: string;
  [key: string]: unknown;
};

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
