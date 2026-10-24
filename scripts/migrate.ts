/** Apply only the configured project's ordered Drizzle migrations, with redacted failures. */
import postgres from "postgres";
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import "../src/server/env";

const url = process.env["DATABASE_URL_MIGRATE"]?.trim();
if (!url) throw new Error("DATABASE_URL_MIGRATE is required for migrations.");
const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
let selectedFolder: string | undefined;
try {
  // Required for expand/deploy/contract rollouts; never apply contract before deployment.
  const through = process.argv
    .find((arg) => arg.startsWith("--through="))
    ?.slice("--through=".length);
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const targetIndex = through
    ? journal.entries.findIndex((entry: { tag: string }) => entry.tag === through)
    : journal.entries.length - 1;
  if (targetIndex < 0) throw new Error("Unknown migration boundary.");
  const contractIndex = journal.entries.findIndex(
    (entry: { tag: string }) => entry.tag === "0028_unified_contract",
  );
  if (
    contractIndex >= 0 &&
    targetIndex >= contractIndex &&
    !process.argv.includes("--confirm-unified-runtime")
  ) {
    console.error(
      "Stop: deploy the unified application and workers after --through=0027_unified_expand, drain old versions, then explicitly use --confirm-unified-runtime for contract.",
    );
    throw new Error("Runtime confirmation required for contract migration.");
  }
  if (through) {
    selectedFolder = await mkdtemp(join(tmpdir(), "zirve-migrations-"));
    await mkdir(join(selectedFolder, "meta"));
    const entries = journal.entries.slice(0, targetIndex + 1);
    await writeFile(
      join(selectedFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries)
      await copyFile(join("drizzle", entry.tag + ".sql"), join(selectedFolder, entry.tag + ".sql"));
  }
  await migrate(drizzle(client), { migrationsFolder: selectedFolder ?? "drizzle" });
  console.log("Configured project migrations applied successfully.");
} catch (error) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  console.error(
    JSON.stringify({
      status: "failed",
      code,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
  if (
    selectedFolder &&
    dirname(resolve(selectedFolder)) === resolve(tmpdir()) &&
    basename(selectedFolder).startsWith("zirve-migrations-")
  )
    await rm(selectedFolder, { recursive: true, force: true });
}
