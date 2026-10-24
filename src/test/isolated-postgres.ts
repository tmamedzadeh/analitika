import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** No env URL or fallback: only our freshly initialized workspace cluster is accepted. */
export async function isolatedPostgres() {
  const base = {
    host: "127.0.0.1",
    port: 55487,
    username: "zirve_test",
    password: "",
    max: 4,
    prepare: false,
    connect_timeout: 3,
  };
  const admin = postgres({ ...base, database: "postgres", max: 1 });
  async function verify(connection: ReturnType<typeof postgres>, database: string) {
    const [identity] =
      await connection`select current_user as role, current_database() as db, current_setting('port') as port, current_setting('data_directory') as directory`;
    const expected = resolve(process.cwd(), ".gate-backup/zirve-pg-0029")
      .replaceAll("\\", "/")
      .toLowerCase();
    if (
      identity?.["role"] !== "zirve_test" ||
      identity["db"] !== database ||
      identity["port"] !== "55487" ||
      String(identity["directory"]).replaceAll("\\", "/").toLowerCase() !== expected
    )
      throw new Error("REFUSED: database isolation identity mismatch");
  }
  const database = "zirve_test_0029_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  try {
    await verify(admin, "postgres");
    await admin.unsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  const client = postgres({ ...base, database });
  await verify(client, database); // Required before ANY migration/fixture SQL.
  await client
    .unsafe(
      `
    CREATE TABLE app_users(id text primary key, username text not null default 'synthetic', password_hash text not null default 'unused', role text not null default 'user', clearance text not null default 'secret', active boolean not null default true, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE documents(id uuid primary key, title text not null, body text not null, body_rich jsonb not null, department text, direction text, doc_date date, language text default 'az', classification text default 'open', source_reliability char(1), info_credibility smallint, owner_id text not null references app_users(id), status text default 'queued', chunk_count integer default 0, step text default 'queued', progress jsonb default '{}', error text, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE attachments(id uuid primary key, document_id uuid not null references documents(id) on delete cascade, storage_key text unique not null, image_metadata jsonb, mime text not null, size integer not null, caption text);
    CREATE TABLE brief_attachments(id uuid primary key, storage_key text, image_metadata jsonb);
  `,
    )
    .simple();
  const migration = await readFile("drizzle/0029_document_image_reliability_expand.sql", "utf8");
  await client.begin(async (tx) => {
    for (const statement of migration.split("--> statement-breakpoint"))
      if (statement.trim()) await tx.unsafe(statement);
  });
  return { client, verify: () => verify(client, database) };
}
