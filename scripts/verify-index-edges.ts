/** Additional lifecycle races only, using scoped live DB fixtures and local vectors. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import { appUsers, chunks, dailyBriefs, documents } from "../src/server/db/schema";
import { withCurrentUser, type SessionUser } from "../src/server/auth";
import { processDocumentJob } from "../src/server/jobs/process-document";
import { indexBriefJob } from "../src/server/jobs/index-brief";
import { recoverPendingDocuments } from "../src/server/jobs/recover-indexes";
import { saveBriefRecord } from "../src/server/briefs/mutations";
import { hasCommittedBriefIndex } from "../src/server/briefs/index-state";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";
import { getBakuDate } from "../src/lib/briefs";
import type { EmbeddingProvider } from "../src/server/ai/types";
import { GeminiQuotaExceededError } from "../src/server/ai/gemini-gateway";

requireProjectEvaluationDatabase();
const user: SessionUser = {
  id: crypto.randomUUID(),
  username: `index_${crypto.randomUUID()}`,
  role: "user",
  clearance: "open",
  sessionId: "local-evaluation",
};
const docIds = Array.from({ length: 2 }, () => crypto.randomUUID());
const briefIds = Array.from({ length: 2 }, () => crypto.randomUUID());
const vector: number[] = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const checks: string[] = [];
let stage = "setup";
function provider(
  run = (values: string[]) => Promise.resolve(values.map(() => vector)),
): EmbeddingProvider {
  return {
    model: "synthetic-index-edges",
    processingBoundary: "local",
    embedDocument: async () => vector,
    embedQuery: async () => vector,
    embedQueries: async (values) => values.map(() => vector),
    embedDocuments: run,
  };
}
async function check(name: string, run: () => Promise<void>) {
  stage = name;
  await run();
  checks.push(name);
  console.log(`PASS: ${name}`);
}
function gate() {
  let release!: (vectors: number[][]) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<number[][]>((resolve) => {
    release = resolve;
  });
  return {
    ready,
    release: () => release([vector]),
    embeddings: provider(async () => {
      started();
      return blocked;
    }),
  };
}
async function ids(kind: "document" | "brief", id: string) {
  return (
    await getDb()
      .select({ id: chunks.id })
      .from(chunks)
      .where(kind === "document" ? eq(chunks.documentId, id) : eq(chunks.briefId, id))
  )
    .map((row) => row.id)
    .sort();
}
try {
  await getDb().insert(appUsers).values({
    id: user.id,
    username: user.username,
    passwordHash: "unusable-synthetic",
    role: user.role,
    clearance: user.clearance,
  });
  await getDb()
    .insert(documents)
    .values(
      docIds.map((id) => ({
        id,
        ownerId: user.id,
        title: "Synthetic lifecycle",
        body: "Synthetic lifecycle has 42 units.",
        direction: "OSINT",
        status: "queued" as const,
      })),
    );
  await getDb()
    .insert(dailyBriefs)
    .values(
      briefIds.map((id) => ({
        id,
        authorId: user.id,
        title: "Synthetic lifecycle",
        body: "Synthetic brief has 42 units.",
        briefDate: getBakuDate(),
        status: "published",
        indexStatus: "queued",
      })),
    );
  await check("deleted document and brief events are harmless no-ops", async () => {
    let calls = 0;
    const embeddings = provider(async () => {
      calls++;
      return [vector];
    });
    await processDocumentJob(crypto.randomUUID(), { embeddings });
    await indexBriefJob(crypto.randomUUID(), { embeddings });
    assert.equal(calls, 0);
  });
  for (const kind of ["document", "brief"] as const)
    await check(`${kind}: delete while embedding cannot resurrect chunks`, async () => {
      const id = kind === "document" ? docIds[1]! : briefIds[1]!;
      const control = gate();
      const pending =
        kind === "document"
          ? processDocumentJob(id, { embeddings: control.embeddings })
          : indexBriefJob(id, { embeddings: control.embeddings });
      try {
        await control.ready;
        if (kind === "document")
          await getDb()
            .delete(documents)
            .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)));
        else
          await getDb()
            .delete(dailyBriefs)
            .where(and(eq(dailyBriefs.id, id), eq(dailyBriefs.authorId, user.id)));
      } finally {
        control.release();
        await pending;
      }
      assert.equal((await ids(kind, id)).length, 0);
    });
  await check(
    "brief edit fences active indexer; retained old chunks excluded until fresh pass",
    async () => {
      const id = briefIds[0]!;
      await indexBriefJob(id, { embeddings: provider() });
      const before = await ids("brief", id);
      await getDb()
        .update(dailyBriefs)
        .set({ indexStatus: "queued" })
        .where(eq(dailyBriefs.id, id));
      const control = gate();
      const pending = indexBriefJob(id, { embeddings: control.embeddings });
      try {
        await control.ready;
        await withCurrentUser(user, () =>
          saveBriefRecord(
            {
              briefId: id,
              isNew: false,
              date: getBakuDate(),
              title: "Synthetic edited lifecycle",
              body: "Synthetic edited brief now has 43 units.",
              status: "published",
              keepAttachmentIds: [],
              uploads: [],
            },
            { sendIndexing: async () => undefined },
          ),
        );
      } finally {
        control.release();
        await pending;
      }
      assert.deepEqual(await ids("brief", id), before);
      assert.equal(
        (
          await getDb()
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(and(eq(dailyBriefs.id, id), hasCommittedBriefIndex()))
        ).length,
        0,
      );
      await indexBriefJob(id, { embeddings: provider() });
      assert.notDeepEqual(await ids("brief", id), before);
    },
  );
  await processDocumentJob(docIds[0]!, { embeddings: provider() });
  for (const kind of ["document", "brief"] as const)
    await check(
      `${kind}: malformed vectors and terminal quota preserve committed index`,
      async () => {
        const id = kind === "document" ? docIds[0]! : briefIds[0]!;
        const before = await ids(kind, id);
        assert.ok(before.length);
        for (const embeddings of [
          provider(async () => [Array.from({ length: 768 }, () => 0)]),
          provider(async () => {
            throw new GeminiQuotaExceededError("GEMINI_EMBED_MODEL", "per-day");
          }),
        ]) {
          if (kind === "document")
            await getDb().update(documents).set({ status: "queued" }).where(eq(documents.id, id));
          else
            await getDb()
              .update(dailyBriefs)
              .set({ indexStatus: "queued" })
              .where(eq(dailyBriefs.id, id));
          await assert.rejects(
            kind === "document"
              ? processDocumentJob(id, { embeddings })
              : indexBriefJob(id, { embeddings }),
          );
          assert.deepEqual(await ids(kind, id), before);
        }
      },
    );
  await check("durable queued state recovers after DB pool reconnect", async () => {
    const id = docIds[0]!;
    await getDb()
      .update(documents)
      .set({
        status: "queued",
        progress: { recoveryAttempts: 0 },
        updatedAt: new Date(Date.now() - 3600_000),
      })
      .where(eq(documents.id, id));
    await closeDb();
    let sent = 0;
    const recovered = await recoverPendingDocuments(async () => {
      sent++;
    }, [id]);
    assert.equal(recovered.queued, 1);
    assert.equal(sent, 1);
    await processDocumentJob(id, { embeddings: provider() });
    const [row] = await getDb()
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, id));
    assert.equal(row?.status, "ready");
  });
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
  await getDb()
    .delete(documents)
    .where(and(eq(documents.ownerId, user.id), inArray(documents.id, docIds)));
  await getDb()
    .delete(dailyBriefs)
    .where(and(eq(dailyBriefs.authorId, user.id), inArray(dailyBriefs.id, briefIds)));
  await getDb().delete(appUsers).where(eq(appUsers.id, user.id));
  const leftDocs = await ids("document", docIds[0]!);
  const leftBriefs = await ids("brief", briefIds[0]!);
  assert.equal(leftDocs.length + leftBriefs.length, 0);
  const result = {
    checkedAt: new Date().toISOString(),
    status: process.exitCode ? "FAIL" : "PASS",
    failureCase: process.exitCode ? stage : null,
    checks,
    fixtureLeftovers: 0,
    provider: "local synthetic vectors only",
    coldRestartLimit:
      "Only DB pool restarted; actual worker process restart/cloud scheduled recovery remain NOT VERIFIED",
    nonpublishedBriefs:
      "Database constraint permits published only; no invalid nonpublished fixture forced into corpus",
  };
  await writeFile(
    "docs/release/INDEX_LIFECYCLE_EDGES.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
