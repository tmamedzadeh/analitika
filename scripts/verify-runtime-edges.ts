import { plainTextDocument } from "../src/lib/rich-text";
/** Real local production HTTP + same live DB/storage; provider transport is synthetic in a separate subprocess. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import {
  analyticsQueries,
  appSessions,
  appUsers,
  attachments,
  briefAttachments,
  chunks,
  dailyBriefs,
  documents,
} from "../src/server/db/schema";
import { createSession } from "../src/server/auth";
import { hashPassword } from "../src/server/auth/password";
import { getStorage, closeStorage } from "../src/server/storage/s3";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";
import { az } from "../src/lib/i18n/az";
import { getBakuDate } from "../src/lib/briefs";

requireProjectEvaluationDatabase();
const db = getDb();
const userId = crypto.randomUUID();
const documentId = crypto.randomUUID();
const secretId = crypto.randomUUID();
const briefId = crypto.randomUUID();
const attachmentId = crypto.randomUUID();
const briefAttachmentId = crypto.randomUUID();
const token = `rc${crypto.randomUUID().replaceAll("-", "")}`;
const key = `documents/${documentId}/committed/${crypto.randomUUID()}.png`;
const briefKey = `briefs/${briefId}/committed/${crypto.randomUUID()}.png`;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const base = "http://127.0.0.1:4176";
const checks: Array<{ name: string; status: "PASS" }> = [];
let child: ChildProcess | undefined;
let cookie = "";
let stage = "setup";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name: string, run: () => Promise<void>) {
  stage = name;
  await run();
  checks.push({ name, status: "PASS" });
  console.log(`PASS: ${name}`);
}
async function counts(): Promise<Record<string, number>> {
  return JSON.parse(
    await readFile(".release-backup.local/controlled-ai-counts.json", "utf8").catch(() => "{}"),
  );
}
async function history(query: string) {
  const [row] = await db
    .select({
      status: analyticsQueries.status,
      answer: analyticsQueries.answer,
      model: analyticsQueries.model,
      durationMs: analyticsQueries.durationMs,
    })
    .from(analyticsQueries)
    .where(and(eq(analyticsQueries.createdBy, userId), eq(analyticsQueries.query, query)));
  return row;
}
async function waitHistory(query: string, status: string) {
  for (let i = 0; i < 40; i++) {
    const row = await history(query);
    if (row?.status === status) return row;
    await pause(150);
  }
  assert.fail(`Expected history status ${status}`);
}
function search(query: string, mode = "answer", signal?: AbortSignal) {
  return fetch(`${base}/api/analytics/search`, {
    method: "POST",
    headers: { cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      mode,
      filters: {
        includeBriefs: true,
        period: "all",
        directionIds: ["OSINT"],
        minSourceReliability: "all",
        minInfoCredibility: "all",
      },
    }),
    ...(signal ? { signal } : {}),
  });
}
try {
  // Refuse to use an unrelated process already listening on the controlled port.
  const occupied = await fetch(`${base}/login`, { signal: AbortSignal.timeout(500) }).then(
    () => true,
    () => false,
  );
  assert.equal(occupied, false, "Controlled test port is already occupied");
  await unlink(".release-backup.local/controlled-ai-counts.json").catch(() => undefined);
  child = spawn(
    process.execPath,
    ["run", "--preload=./scripts/controlled-ai-preload.ts", "scripts/preview.ts", "4176"],
    {
      env: {
        ...process.env,
        RELEASE_CONTROLLED_AI: "synthetic-only",
        RELEASE_CONTROLLED_RUN_ID: token,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Controlled preview terminated");
    if (
      await fetch(`${base}/login`, { signal: AbortSignal.timeout(1000) }).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await pause(200);
    if (i === 99) throw new Error("Controlled preview did not start");
  }
  await db.insert(appUsers).values({
    id: userId,
    username: `runtime_${userId}`,
    passwordHash: await hashPassword(crypto.randomUUID()),
    role: "admin",
    clearance: "open",
  });
  const body = `${token} Synthetic fixture has 42 units.`;
  await db.insert(documents).values([
    {
      id: documentId,
      ownerId: userId,
      title: `Runtime ${token}`,
      body,
      bodyRich: plainTextDocument(body),
      direction: "OSINT",
      classification: "open",
      status: "ready",
      step: "ready",
      chunkCount: 1,
    },
    {
      id: secretId,
      ownerId: userId,
      title: "Restricted synthetic fixture",
      body: `${token} restrictedmarker`,
      bodyRich: plainTextDocument(`${token} restrictedmarker`),
      direction: "OSINT",
      classification: "secret",
      status: "ready",
      step: "ready",
      chunkCount: 1,
    },
  ]);
  for (const [id, text] of [
    [documentId, body],
    [secretId, `${token} restrictedmarker`],
  ])
    await db.insert(chunks).values({
      documentId: id!,
      ord: 0,
      text: text!,
      charStart: 0,
      charEnd: text!.length,
      sectionTitle: "Synthetic section",
      embedding: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
      embeddingModel: "gemini-embedding-2",
    });
  await db.insert(dailyBriefs).values({
    id: briefId,
    authorId: userId,
    title: "Synthetic brief",
    body: "Synthetic attachment",
    bodyRich: plainTextDocument("Synthetic attachment"),
    briefDate: getBakuDate(),
    status: "published",
  });
  for (const objectKey of [key, briefKey])
    await getStorage().put({ key: objectKey, body: png, contentType: "image/png" });
  await db.insert(attachments).values({
    id: attachmentId,
    documentId,
    storageKey: key,
    mime: "image/png",
    size: png.length,
    caption: "synthetic.png",
  });
  await db.insert(briefAttachments).values({
    id: briefAttachmentId,
    briefId,
    storageKey: briefKey,
    mime: "image/png",
    size: png.length,
    name: "synthetic.png",
    ord: 0,
  });
  cookie = `analitika_session=${(await createSession(userId)).token}`;
  const attachmentUrl = `${base}/api/attachments/document/${documentId}/${attachmentId}`;
  await check("attachment HTTP private/auth/UUID/clearance and brief access", async () => {
    assert.equal((await fetch(attachmentUrl)).status, 401);
    const response = await fetch(attachmentUrl, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(response.headers.get("cache-control")?.includes("no-store"));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
    assert.equal(
      (
        await fetch(`${base}/api/attachments/document/${secretId}/${attachmentId}`, {
          headers: { cookie },
        })
      ).status,
      404,
    );
    await db
      .update(documents)
      .set({ classification: "secret" })
      .where(eq(documents.id, documentId));
    assert.equal((await fetch(attachmentUrl, { headers: { cookie } })).status, 404);
    await db.update(documents).set({ classification: "open" }).where(eq(documents.id, documentId));
    assert.equal(
      (
        await fetch(`${base}/api/attachments/brief/${briefId}/${briefAttachmentId}`, {
          headers: { cookie },
        })
      ).status,
      200,
    );
  });
  await check("active/session revalidation on real HTTP", async () => {
    await db.update(appUsers).set({ active: false }).where(eq(appUsers.id, userId));
    assert.equal((await fetch(attachmentUrl, { headers: { cookie } })).status, 401);
    await db.update(appUsers).set({ active: true }).where(eq(appUsers.id, userId));
    assert.equal((await fetch(attachmentUrl, { headers: { cookie } })).status, 401);
    cookie = `analitika_session=${(await createSession(userId)).token}`;
  });
  await check(
    "classified question never dispatched; lexical sources remain available",
    async () => {
      await db.update(appUsers).set({ clearance: "secret" }).where(eq(appUsers.id, userId));
      const before = await counts();
      const sources = await (await search(`${token} rcquerypolicy sources`, "sources")).text();
      assert.ok(sources.includes('"type":"final"'));
      assert.ok(sources.includes(documentId));
      const answer = await (await search(`${token} rcquerypolicy answer`)).text();
      assert.ok(answer.includes('"type":"error"'));
      assert.ok(!answer.includes('"type":"final"'));
      assert.deepEqual(await counts(), before);
      await db.update(appUsers).set({ clearance: "open" }).where(eq(appUsers.id, userId));
    },
  );
  await check(
    "embedding quota uses lexical fallback without leaking restricted sources",
    async () => {
      const stream = await (await search(`${token} rcembedoutage`, "sources")).text();
      assert.ok(stream.includes('"type":"final"'));
      assert.ok(stream.includes(documentId));
      assert.ok(!stream.includes(secretId));
      assert.ok(!stream.includes("restrictedmarker"));
      assert.equal((await counts())["rcembedoutage_embedding"], 1);
    },
  );
  await check(
    "quota fallback records the actual light model in stream and durable history",
    async () => {
      const query = `${token} rcquota`;
      const stream = await (await search(query)).text();
      assert.ok(stream.includes('"type":"final"'));
      assert.ok(stream.includes("gemini-3.5-flash-lite"));
      assert.equal((await counts())["rcquota_generation"], 2);
      assert.equal((await waitHistory(query, "done")).model, "gemini-3.5-flash-lite");
    },
  );
  await check(
    "malformed retry succeeds with validated no-answer; completed history survives late abort",
    async () => {
      const query = `${token} rcretry`;
      const abort = new AbortController();
      const stream = await (await search(query, "answer", abort.signal)).text();
      assert.ok(stream.includes('"type":"final"'));
      assert.ok(stream.includes(az.analytics.noSources));
      assert.ok(!stream.includes("Synthetic invalid claim"));
      assert.equal((await counts())["rcretry_generation"], 2);
      await waitHistory(query, "done");
      abort.abort();
      await pause(200);
      assert.equal((await history(query))?.status, "done");
    },
  );
  await check(
    "malformed generation exhausts two validation attempts; no invalid answer published",
    async () => {
      const query = `${token} rcmalformed`;
      const stream = await (await search(query)).text();
      assert.ok(stream.includes('"type":"error"'));
      assert.ok(!stream.includes('"type":"final"'));
      assert.ok(!stream.includes("Synthetic invalid claim"));
      assert.equal((await counts())["rcmalformed_generation"], 2);
      assert.ok(!(await waitHistory(query, "failed")).answer);
    },
  );
  await check("real HTTP disconnect cancels provider and durable history", async () => {
    const query = `${token} rccancel`;
    const response = await search(query);
    const reader = response.body!.getReader();
    await reader.read();
    for (let i = 0; i < 50 && !(await counts())["rccancel_generation"]; i++) await pause(100);
    assert.equal((await counts())["rccancel_generation"], 1);
    await reader.cancel();
    await waitHistory(query, "cancelled");
  });
  await check(
    "actual 105-second endpoint deadline fails history and closes HTTP stream",
    async () => {
      const query = `${token} rcdeadline`;
      const stream = await (await search(query, "answer", AbortSignal.timeout(125_000))).text();
      assert.ok(!stream.includes('"type":"final"'));
      assert.ok(!stream.includes("Synthetic invalid claim"));
      const row = await waitHistory(query, "failed");
      assert.ok(row.durationMs! >= 100_000 && row.durationMs! < 120_000);
      assert.equal((await counts())["rcdeadline_generation"], 2);
    },
  );
} catch (error) {
  process.exitCode = 1;
  console.error(
    JSON.stringify({
      status: "FAIL",
      stage,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
} finally {
  child?.kill();
  await db
    .delete(documents)
    .where(and(eq(documents.ownerId, userId), inArray(documents.id, [documentId, secretId])));
  await db
    .delete(dailyBriefs)
    .where(and(eq(dailyBriefs.authorId, userId), eq(dailyBriefs.id, briefId)));
  await db.delete(analyticsQueries).where(eq(analyticsQueries.createdBy, userId));
  await db.delete(appUsers).where(eq(appUsers.id, userId));
  for (const objectKey of [key, briefKey]) {
    await getStorage().delete(objectKey);
    await assert.rejects(getStorage().getMetadata(objectKey));
  }
  const leftovers = await Promise.all([
    db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, userId)),
    db.select({ id: appSessions.id }).from(appSessions).where(eq(appSessions.userId, userId)),
    db
      .select({ id: chunks.id })
      .from(chunks)
      .where(inArray(chunks.documentId, [documentId, secretId])),
    db
      .select({ id: analyticsQueries.id })
      .from(analyticsQueries)
      .where(eq(analyticsQueries.createdBy, userId)),
  ]);
  const fixtureLeftovers = leftovers.reduce((sum, rows) => sum + rows.length, 0);
  assert.equal(fixtureLeftovers, 0);
  const result = {
    checkedAt: new Date().toISOString(),
    status: process.exitCode ? "FAIL" : "PASS",
    failureCase: process.exitCode ? stage : null,
    checks,
    fixtureLeftovers,
    storageCleanup: "exact two synthetic keys deleted and absence verified",
    provider: "actual SDK; synthetic fetch transport in local subprocess; no external AI calls",
    cloudWorkerDelivery: "NOT VERIFIED",
  };
  await writeFile("docs/release/RUNTIME_EDGES.json", JSON.stringify(result, null, 2) + "\n");
  closeStorage();
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
