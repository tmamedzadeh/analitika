/** Apply only the configured project's ordered Drizzle migrations, with redacted failures. */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import "../src/server/env";

const url = process.env["DATABASE_URL_MIGRATE"]?.trim();
if (!url) throw new Error("DATABASE_URL_MIGRATE is required for migrations.");
const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
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
}
