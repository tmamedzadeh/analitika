import { defineConfig } from "drizzle-kit";
import process from "node:process";
import { loadEnv } from "vite";

const env = loadEnv("development", process.cwd(), "");
const migrationUrl = (process.env.DATABASE_URL_MIGRATE ?? env.DATABASE_URL_MIGRATE)?.trim();

if (!migrationUrl) {
  throw new Error("DATABASE_URL_MIGRATE is required for Drizzle migrations.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: migrationUrl,
  },
  strict: true,
  verbose: true,
});
