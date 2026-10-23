import { plainTextDocument } from "../src/lib/rich-text";
/** Scoped invented fixtures on the configured project DB. No external AI calls or corpus changes. */
import assert from "node:assert/strict";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db";
import {
  appUsers,
  appSessions,
  dailyBriefs,
  briefAttachments,
  chunks,
  analyticsQueries,
} from "../src/server/db/schema";
import { withCurrentUser, type SessionUser } from "../src/server/auth";
import { clearanceValues } from "../src/lib/classification";
import { listBriefsPage, getBriefDetails } from "../src/server/briefs/queries";
import { saveBriefRecord } from "../src/server/briefs/mutations";
import { searchDocumentChunks } from "../src/server/analytics/search";
import { recheckAnalyticsSourceAccess } from "../src/server/analytics/source-access";
import {
  getAnalyticsHistoryRecord,
  listAnalyticsHistory,
  buildAnalyticsHistorySnapshot,
} from "../src/server/analytics/history";
import { directionIds } from "../src/lib/directions";
import { getBakuDate } from "../src/lib/briefs";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";
import { closeStorage } from "../src/server/storage/s3";

requireProjectEvaluationDatabase();
const db = getDb();
const runId = randomUUID();
const userId = `classification-${runId}`;
const otherId = `classification-author-${runId}`;
const token = `classprobe${runId.replaceAll("-", "")}`;
const ids: string[] = clearanceValues.map(() => randomUUID());
const chunkIds = clearanceValues.map(() => randomUUID());
const attachmentIds = clearanceValues.map(() => randomUUID());
const historyId = randomUUID();
const newId = randomUUID();
const user: SessionUser = {
  id: userId,
  username: token,
  role: "admin",
  clearance: "special",
  sessionId: "synthetic",
};
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const filters = {
  includeBriefs: true,
  period: "all" as const,
  directionIds: [...directionIds],
  minSourceReliability: "all" as const,
  minInfoCredibility: "all" as const,
};
const date = getBakuDate();
const baseUrl = process.argv[2];
if (baseUrl)
  assert(
    ["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname),
    "Only local HTTP verification is permitted.",
  );
const checks: string[] = [];
const asUser = <T>(operation: () => T) => withCurrentUser(user, operation);
const input = (index: number) => ({
  briefId: ids[index]!,
  isNew: false,
  date,
  title: `${token} ${index}`,
  body: `${token} invented bulletin ${index}.`,
  bodyRich: plainTextDocument(`${token} invented bulletin ${index}.`),
  status: "published" as const,
  classification: clearanceValues[index]!,
  keepAttachmentIds: [attachmentIds[index]!],
  uploads: [],
});
let stage = "setup";
try {
  await db.insert(appUsers).values(
    [userId, otherId].map((id, index) => ({
      id,
      username: `${token}${index}`,
      passwordHash: "disabled-synthetic-fixture",
      clearance: "special",
      role: "admin" as const,
    })),
  );
  await db.insert(dailyBriefs).values(
    clearanceValues.map((classification, index) => ({
      id: ids[index]!,
      briefDate: date,
      title: input(index).title,
      body: input(index).body,
      bodyRich: plainTextDocument(input(index).body),
      classification,
      authorId: userId,
      indexStatus: "ready",
      publishedAt: new Date(),
    })),
  );
  await db.insert(chunks).values(
    ids.map((id, index) => ({
      id: chunkIds[index]!,
      briefId: id,
      ord: 0,
      text: input(index).body,
      sectionTitle: "Invented fixture",
      charStart: 0,
      charEnd: input(index).body.length,
      embedding: vector,
      embeddingModel: process.env["GEMINI_EMBED_MODEL"]!.trim(),
    })),
  );
  await db.insert(briefAttachments).values(
    ids.map((id, index) => ({
      id: attachmentIds[index]!,
      briefId: id,
      storageKey: `synthetic-only/${runId}/${index}`,
      name: "invented.png",
      mime: "image/png",
      size: 1,
      ord: 0,
    })),
  );
  stage = "clearance-matrix";
  for (const role of ["user", "admin"] as const) {
    for (const [ceiling, clearance] of clearanceValues.entries()) {
      await db.update(appUsers).set({ clearance, role }).where(eq(appUsers.id, userId));
      const page = await asUser(() =>
        listBriefsPage({ query: token, period: "all", month: "", cursor: null }),
      );
      assert.deepEqual(
        new Set(page.items.map((item) => item.id)),
        new Set(ids.slice(0, ceiling + 1)),
      );
      for (const [level, id] of ids.entries()) {
        const detail = await asUser(() => getBriefDetails(id));
        assert.equal(Boolean(detail), level <= ceiling);
        if (detail) {
          assert.equal(detail.brief.classification, clearanceValues[level]);
          assert.equal(detail.brief.photos.length, 1);
        }
      }
      const sources = await asUser(() =>
        searchDocumentChunks(token, filters, { embedding: vector, enableRerank: false }),
      );
      assert.deepEqual(
        new Set(
          sources
            .filter((source) => source.briefId && ids.includes(source.briefId))
            .map((source) => source.briefId),
        ),
        new Set(ids.slice(0, ceiling + 1)),
      );
      for (const source of sources.filter(
        (source) => source.briefId && ids.includes(source.briefId),
      ))
        assert.equal(source.classification, clearanceValues[ids.indexOf(source.briefId!)]);
    }
  }
  checks.push(
    "all four live clearance levels for users/admins across catalog, UUID details, photos, vector/FTS/trigram candidates and source metadata; stale special session and owner never bypass ceiling",
  );
  stage = "writes";
  await db
    .update(appUsers)
    .set({ clearance: "open", role: "admin" })
    .where(eq(appUsers.id, userId));
  await assert.rejects(
    asUser(() =>
      saveBriefRecord(
        { ...input(1), briefId: newId, isNew: true, keepAttachmentIds: [] },
        { sendIndexing: async () => {} },
      ),
    ),
  );
  await assert.rejects(
    asUser(() =>
      saveBriefRecord({ ...input(1), classification: "open" }, { sendIndexing: async () => {} }),
    ),
  );
  await db
    .update(appUsers)
    .set({ clearance: "special", role: "user" })
    .where(eq(appUsers.id, userId));
  await assert.rejects(
    asUser(() =>
      saveBriefRecord({ ...input(1), classification: "open" }, { sendIndexing: async () => {} }),
    ),
  );
  await db.update(dailyBriefs).set({ authorId: otherId }).where(eq(dailyBriefs.id, ids[3]!));
  await assert.rejects(asUser(() => saveBriefRecord(input(3), { sendIndexing: async () => {} })));
  checks.push(
    "server rejects over-clearance creation, inaccessible edits, non-admin declassification and stale admin role",
  );
  stage = "classification-only-edit";
  await db
    .update(appUsers)
    .set({ clearance: "special", role: "admin" })
    .where(eq(appUsers.id, userId));
  await asUser(() =>
    saveBriefRecord(
      { ...input(2), briefId: newId, isNew: true, keepAttachmentIds: [] },
      { sendIndexing: async () => {} },
    ),
  );
  const [created] = await db.select().from(dailyBriefs).where(eq(dailyBriefs.id, newId));
  assert.equal(created!.classification, "top_secret");
  assert.equal(created!.indexStatus, "queued");
  checks.push("classified bulletin creation persists validated classification and queues indexing");
  let indexEvents = 0;
  await asUser(() =>
    saveBriefRecord(
      { ...input(0), classification: "secret" },
      {
        sendIndexing: async () => {
          indexEvents++;
        },
      },
    ),
  );
  const [edited] = await db.select().from(dailyBriefs).where(eq(dailyBriefs.id, ids[0]!));
  assert.equal(edited!.classification, "secret");
  assert.equal(edited!.indexStatus, "ready");
  assert.equal(indexEvents, 0);
  assert.equal((await db.select().from(chunks).where(eq(chunks.id, chunkIds[0]!))).length, 1);
  checks.push("classification-only save preserves ready chunks and emits no indexing event");
  stage = "history-and-revocation";
  const allSources = await asUser(() =>
    searchDocumentChunks(token, filters, { embedding: vector, enableRerank: false }),
  );
  const source = allSources.find((item) => item.briefId === ids[0])!;
  assert(source);
  const snapshot = buildAnalyticsHistorySnapshot(
    [source],
    "Invented answer [1]",
    "synthetic",
    1,
    new Date(),
  );
  assert.equal(snapshot.maxClassification, "secret");
  // Legacy open snapshot must still obey a source's current classification.
  await db.insert(analyticsQueries).values({
    id: historyId,
    createdBy: userId,
    query: "Invented question",
    filters,
    status: "done",
    answer: "Invented answer",
    sources: snapshot.snapshots,
    maxClassification: "open",
    model: "synthetic",
  });
  assert(await asUser(() => getAnalyticsHistoryRecord(historyId)));
  await db.update(appUsers).set({ clearance: "open" }).where(eq(appUsers.id, userId));
  assert.equal(await asUser(() => getAnalyticsHistoryRecord(historyId)), null);
  assert(!(await asUser(() => listAnalyticsHistory())).some((item) => item.id === historyId));
  assert.equal((await asUser(() => recheckAnalyticsSourceAccess([source], userId))).length, 0);
  await db.update(appUsers).set({ clearance: "secret" }).where(eq(appUsers.id, userId));
  assert(await asUser(() => getAnalyticsHistoryRecord(historyId)));
  await db
    .update(dailyBriefs)
    .set({ classification: "special" })
    .where(eq(dailyBriefs.id, ids[0]!));
  assert.equal(await asUser(() => getAnalyticsHistoryRecord(historyId)), null);
  assert.equal((await asUser(() => recheckAnalyticsSourceAccess([source], userId))).length, 0);
  checks.push(
    "history metadata/answer/previews and pre-prompt/publication rechecks deny clearance downgrade and source upgrade, including legacy open snapshots",
  );
  if (baseUrl) {
    stage = "attachment-http";
    const sessionToken = randomBytes(32).toString("base64url");
    await db.insert(appSessions).values({
      userId,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await fetch(`${baseUrl}/api/attachments/brief/${ids[3]}/${attachmentIds[3]}`, {
      headers: { cookie: `analitika_session=${sessionToken}` },
    });
    assert.equal(response.status, 404);
    checks.push("direct classified photo URL returns 404 through the real local HTTP route");
  }
  await db.update(appUsers).set({ active: false }).where(eq(appUsers.id, userId));
  assert.equal(
    (await asUser(() => listBriefsPage({ query: token, period: "all", month: "", cursor: null })))
      .items.length,
    0,
  );
  assert.equal(await asUser(() => getBriefDetails(ids[1]!)), null);
  checks.push("deactivated user denied");
  console.log(JSON.stringify({ status: "PASS", checks }));
  await writeFile(
    "docs/release/CLASSIFIED_BRIEFS_INTEGRATION.json",
    JSON.stringify(
      { capturedAt: new Date().toISOString(), status: "PASS", checks, externalAiCalls: 0 },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      stage,
      errorType: error instanceof Error ? error.name : "unknown",
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.delete(analyticsQueries).where(eq(analyticsQueries.id, historyId));
  await db.delete(dailyBriefs).where(inArray(dailyBriefs.id, [...ids, newId]));
  await db.delete(appUsers).where(inArray(appUsers.id, [userId, otherId]));
  await closeDb();
  closeStorage();
}
