import process from "node:process";
import { and, desc, eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import { osintRuns } from "../src/server/db/schema";
import { normalizeOsintQuery } from "../src/server/osint/urls";

const query = process.argv
  .slice(2)
  .filter((value) => value !== "--")
  .join(" ")
  .trim();
if (!query) throw new Error('Usage: bun run osint:pin "<query>"');
try {
  const rows = await getDb()
    .select({ id: osintRuns.id, query: osintRuns.query })
    .from(osintRuns)
    .where(and(eq(osintRuns.status, "done"), eq(osintRuns.pinned, false)))
    .orderBy(desc(osintRuns.createdAt))
    .limit(200);
  const target = rows.find((row) => normalizeOsintQuery(row.query) === normalizeOsintQuery(query));
  if (!target) throw new Error("No completed matching run was found.");
  await getDb().update(osintRuns).set({ pinned: true }).where(eq(osintRuns.id, target.id));
  console.log("Pinned completed OSINT result " + target.id + ".");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not pin OSINT result.");
  process.exitCode = 1;
} finally {
  await closeDb();
}
