import { createInterface } from "node:readline/promises";
import process from "node:process";
import { and, eq, sql } from "drizzle-orm";

import { hashPassword, normalizeUsername } from "../src/server/auth/password";
import { closeDb, getDb } from "../src/server/db";
import { appUsers } from "../src/server/db/schema";

const clearanceChoices = ["open", "secret", "top_secret", "special"] as const;

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY)
    throw new Error("Run this command in an interactive terminal.");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      const text = String(chunk);
      for (const character of text) {
        if (character === "\u0003") {
          finish(new Error("Input cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdout.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let usernameInput: string;
  let clearanceInput: string;
  try {
    usernameInput = await terminal.question("Admin username: ");
    clearanceInput = await terminal.question(`Clearance (${clearanceChoices.join(", ")}): `);
  } finally {
    terminal.close();
  }
  const username = normalizeUsername(usernameInput);
  if (!username || username.length > 50) throw new Error("Username must contain 1–50 characters.");
  if (!clearanceChoices.includes(clearanceInput as (typeof clearanceChoices)[number])) {
    throw new Error(`Choose one of: ${clearanceChoices.join(", ")}.`);
  }

  const password = await readHidden("Password (12–256 characters): ");
  const confirmation = await readHidden("Confirm password: ");
  if (password.length < 12 || password.length > 256) {
    throw new Error("Password must contain 12–256 characters.");
  }
  if (password !== confirmation) throw new Error("Passwords do not match.");
  const passwordHash = await hashPassword(password);
  const db = getDb();

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(716058367)`);
    const [existingAdmin] = await transaction
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.role, "admin"), eq(appUsers.active, true)))
      .limit(1);
    if (existingAdmin) throw new Error("An administrator already exists; bootstrap is disabled.");
    await transaction.insert(appUsers).values({
      id: crypto.randomUUID(),
      username,
      passwordHash,
      role: "admin",
      clearance: clearanceInput,
      active: true,
    });
  });
  console.log(`Administrator ${username} created.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Administrator creation failed.");
  process.exitCode = 1;
} finally {
  await closeDb();
}
