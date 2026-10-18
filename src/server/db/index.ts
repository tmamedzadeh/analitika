import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { readServerEnv, requireServerEnv } from "../env";
import * as schema from "./schema";

function createConnection() {
  const client = postgres(requireServerEnv("DATABASE_URL"), {
    prepare: false,
    max: readServerEnv().DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { client, database: drizzle(client, { schema }) };
}

let connection: ReturnType<typeof createConnection> | undefined;

export function getDb() {
  connection ??= createConnection();
  return connection.database;
}

export async function closeDb(): Promise<void> {
  const current = connection;
  connection = undefined;
  if (current) await current.client.end({ timeout: 5 });
}

export type Database = ReturnType<typeof createConnection>["database"];
