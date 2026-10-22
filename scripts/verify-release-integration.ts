/** Scoped live failure injection in the configured DB. Only new, explicitly tracked fixtures are mutated. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb, type Database } from "../src/server/db";
import {
  analyticsQueries,
  appUsers,
  chunks,
  dailyBriefs,
  documents,
} from "../src/server/db/schema";
import { withCurrentUser, type SessionUser } from "../src/server/auth";
import { documentAccessFilter, documentManagementFilter } from "../src/server/db/access";
import type { EmbeddingProvider } from "../src/server/ai/types";
import { processDocumentJob } from "../src/server/jobs/process-document";
import { indexBriefJob } from "../src/server/jobs/index-brief";
import { recoverPendingBriefs, recoverPendingDocuments } from "../src/server/jobs/recover-indexes";
import { buildBriefListConditions, buildBriefSearchQuery } from "../src/server/briefs/queries";
import { removeBrief, saveBriefRecord } from "../src/server/briefs/mutations";
import { hasCommittedBriefIndex } from "../src/server/briefs/index-state";
import { recheckAnalyticsSourceAccess } from "../src/server/analytics/source-access";
import { getAnalyticsHistoryRecord, listAnalyticsHistory } from "../src/server/analytics/history";
import type { AnalyticsSource } from "../src/lib/analytics";
import { directionIds } from "../src/lib/directions";
import { getBakuDate } from "../src/lib/briefs";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";

requireProjectEvaluationDatabase();
const db = getDb();
const runId = crypto.randomUUID();
const documentIds = [crypto.randomUUID(), crypto.randomUUID()];
const briefId = crypto.randomUUID();
const historyId = crypto.randomUUID();
const users: SessionUser[] = ["user", "admin", "user"].map((role, i) => ({
  id: `release-${runId}-${i}`,
  username: `release_${runId.slice(0, 8)}_${i}`,
  role: role as SessionUser["role"],
  clearance: i === 2 ? "special" : "open",
  sessionId: "release-probe",
}));
const [owner, lowAdmin, highUser] = users as [SessionUser, SessionUser, SessionUser];
const checks: Array<{ name: string; status: "PASS" }> = [];
let currentCase = "fixture creation";
const oldTime = new Date(Date.now() - 60 * 60_000);
const vector = (value = 1) => Array.from({ length: 768 }, (_, i) => (i ? 0 : value));
function provider(behavior?: (values: string[]) => Promise<number[][]>) {
  const state = { calls: 0 };
  const result: EmbeddingProvider & typeof state = {
    ...state,
    model: "release-probe",
    processingBoundary: "local",
    embedDocument: async () => vector(),
    embedQuery: async () => vector(),
    embedQueries: async (values) => values.map(() => vector()),
    async embedDocuments(values) {
      result.calls += 1;
      return behavior ? behavior(values) : values.map(() => vector());
    },
  };
  return result;
}
async function check(name: string, test: () => Promise<void>) {
  currentCase = name;
  await test();
  checks.push({ name, status: "PASS" });
  console.log(`PASS: ${name}`);
}
async function chunkIds(kind: "document" | "brief") {
  return (
    await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(
        kind === "document" ? eq(chunks.documentId, documentIds[0]!) : eq(chunks.briefId, briefId),
      )
  )
    .map((row) => row.id)
    .sort();
}
async function queue(kind: "document" | "brief") {
  if (kind === "document")
    await db
      .update(documents)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(documents.id, documentIds[0]!));
  else
    await db
      .update(dailyBriefs)
      .set({ indexStatus: "queued", updatedAt: new Date() })
      .where(eq(dailyBriefs.id, briefId));
}
const jobs = {
  document: (embeddings: EmbeddingProvider, database?: Database) =>
    processDocumentJob(documentIds[0]!, { embeddings, ...(database ? { database } : {}) }),
  brief: (embeddings: EmbeddingProvider, database?: Database) =>
    indexBriefJob(briefId, { embeddings, ...(database ? { database } : {}) }),
};
const rollbackDb = new Proxy(db, {
  get(target, property, receiver) {
    if (property === "transaction")
      return (
        callback: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<unknown>,
      ) =>
        target.transaction((tx) =>
          callback(
            new Proxy(tx, {
              get(transaction, key, txReceiver) {
                if (key === "insert")
                  return () => {
                    throw new Error("Controlled insert failure after index deletion.");
                  };
                return Reflect.get(transaction, key, txReceiver);
              },
            }),
          ),
        );
    return Reflect.get(target, property, receiver);
  },
});

try {
  await db.insert(appUsers).values(
    users.map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      clearance: user.clearance,
      passwordHash: "disabled-release-probe",
    })),
  );
  await db.insert(documents).values(
    documentIds.map((id, i) => ({
      id,
      title: "Release probe document",
      body: "Synthetic release evidence with 42 sample units.",
      ownerId: owner.id,
      classification: i ? "secret" : "open",
      direction: "OSINT",
      status: "queued" as const,
    })),
  );
  await db.insert(dailyBriefs).values({
    id: briefId,
    authorId: owner.id,
    title: "Release probe brief",
    body: "Synthetic release brief with 42 sample units.",
    briefDate: getBakuDate(),
    indexStatus: "queued",
  });

  for (const kind of ["document", "brief"] as const) {
    await check(`${kind}: initial indexing and duplicate delivery`, async () => {
      const embeddings = provider();
      await jobs[kind](embeddings);
      const ids = await chunkIds(kind);
      assert.ok(ids.length > 0);
      const initialCalls = embeddings.calls;
      await jobs[kind](embeddings);
      assert.equal(embeddings.calls, initialCalls);
      assert.deepEqual(await chunkIds(kind), ids);
    });
    await check(
      `${kind}: provider failure preserves the committed index; retry succeeds`,
      async () => {
        const ids = await chunkIds(kind);
        await queue(kind);
        await assert.rejects(
          jobs[kind](
            provider(async () => {
              throw Object.assign(new Error("controlled network failure"), { code: "ECONNRESET" });
            }),
          ),
        );
        assert.deepEqual(await chunkIds(kind), ids);
        if (kind === "brief") {
          const usable = await db
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(and(eq(dailyBriefs.id, briefId), hasCommittedBriefIndex()));
          assert.equal(usable.length, 1);
        }
        await jobs[kind](provider());
        assert.notDeepEqual(await chunkIds(kind), ids);
      },
    );
    await check(
      `${kind}: transaction rollback restores chunks after delete/insert failure`,
      async () => {
        const ids = await chunkIds(kind);
        await queue(kind);
        await assert.rejects(jobs[kind](provider(), rollbackDb));
        assert.deepEqual(await chunkIds(kind), ids);
        await jobs[kind](provider());
      },
    );
    await check(
      `${kind}: duplicate concurrent events and expired lease fence stale success`,
      async () => {
        await queue(kind);
        let entered!: () => void;
        let release!: (value: number[][]) => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const paused = new Promise<number[][]>((resolve) => {
          release = resolve;
        });
        const oldWorker = jobs[kind](
          provider(async () => {
            entered();
            return paused;
          }),
        );
        await started;
        try {
          const duplicate = provider();
          await jobs[kind](duplicate);
          assert.equal(duplicate.calls, 0);
          if (kind === "document")
            await db
              .update(documents)
              .set({ updatedAt: oldTime })
              .where(eq(documents.id, documentIds[0]!));
          else
            await db
              .update(dailyBriefs)
              .set({ updatedAt: oldTime })
              .where(eq(dailyBriefs.id, briefId));
          await jobs[kind](provider());
          const winner = await chunkIds(kind);
          release([vector(2)]);
          await oldWorker;
          assert.deepEqual(await chunkIds(kind), winner);
        } finally {
          release([vector(2)]);
          await oldWorker.catch(() => undefined);
        }
      },
    );
    await check(
      `${kind}: expired predecessor failure cannot corrupt a newer ready index`,
      async () => {
        await queue(kind);
        let entered!: () => void;
        let rejectOld!: (error: Error) => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const paused = new Promise<number[][]>((_resolve, reject) => {
          rejectOld = reject;
        });
        const oldWorker = jobs[kind](
          provider(async () => {
            entered();
            return paused;
          }),
        );
        const oldResult = oldWorker.catch(() => undefined);
        await started;
        try {
          if (kind === "document")
            await db
              .update(documents)
              .set({ updatedAt: oldTime })
              .where(eq(documents.id, documentIds[0]!));
          else
            await db
              .update(dailyBriefs)
              .set({ updatedAt: oldTime })
              .where(eq(dailyBriefs.id, briefId));
          await jobs[kind](provider());
          const winner = await chunkIds(kind);
          rejectOld(new Error("controlled stale failure"));
          await oldResult;
          assert.deepEqual(await chunkIds(kind), winner);
          const [row] =
            kind === "document"
              ? await db
                  .select({ status: documents.status })
                  .from(documents)
                  .where(eq(documents.id, documentIds[0]!))
              : await db
                  .select({ status: dailyBriefs.indexStatus })
                  .from(dailyBriefs)
                  .where(eq(dailyBriefs.id, briefId));
          assert.equal(row?.status, "ready");
        } finally {
          rejectOld(new Error("controlled cleanup"));
          await oldResult;
        }
      },
    );
  }

  await check(
    "brief: actual save and queue failure retain old chunks; edited chunks stay ineligible",
    async () => {
      const ids = await chunkIds("brief");
      const saved = await withCurrentUser(owner, () =>
        saveBriefRecord(
          {
            briefId,
            isNew: false,
            status: "published",
            date: getBakuDate(),
            title: "Release probe brief",
            body: "Changed synthetic release content.",
            keepAttachmentIds: [],
            uploads: [],
          },
          {
            sendIndexing: async () => {
              throw new Error("controlled queue failure");
            },
          },
        ),
      );
      assert.equal(saved.queueFailed, true);
      assert.deepEqual(await chunkIds("brief"), ids);
      assert.equal(
        (
          await db
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(and(eq(dailyBriefs.id, briefId), hasCommittedBriefIndex()))
        ).length,
        0,
      );
      await jobs.brief(provider());
    },
  );

  for (const kind of ["document", "brief"] as const) {
    await check(
      `${kind}: lost event, failed send, persisted attempt count and bounded recovery`,
      async () => {
        const reset = async (attempts: number) => {
          if (kind === "document")
            await db
              .update(documents)
              .set({
                status: "queued",
                progress: { recoveryAttempts: attempts },
                updatedAt: oldTime,
              })
              .where(eq(documents.id, documentIds[0]!));
          else
            await db
              .update(dailyBriefs)
              .set({
                indexStatus: "queued",
                indexProgress: { recoveryAttempts: attempts },
                updatedAt: oldTime,
              })
              .where(eq(dailyBriefs.id, briefId));
        };
        const recover = (send: (id: string) => Promise<unknown>) =>
          kind === "document"
            ? recoverPendingDocuments(send, [documentIds[0]!])
            : recoverPendingBriefs(send, [briefId]);
        await reset(0);
        let sends = 0;
        await recover(async () => {
          sends++;
          throw new Error("controlled delivery failure");
        });
        assert.equal(sends, 1);
        if (kind === "document")
          await db
            .update(documents)
            .set({ updatedAt: oldTime })
            .where(eq(documents.id, documentIds[0]!));
        else
          await db
            .update(dailyBriefs)
            .set({ updatedAt: oldTime })
            .where(eq(dailyBriefs.id, briefId));
        await recover(async () => {
          sends++;
        });
        assert.equal(sends, 2);
        await jobs[kind](
          provider(async () => {
            throw new Error("controlled permanent provider failure");
          }),
        ).catch(() => undefined);
        const [failed] =
          kind === "document"
            ? await db
                .select({ progress: documents.progress })
                .from(documents)
                .where(eq(documents.id, documentIds[0]!))
            : await db
                .select({ progress: dailyBriefs.indexProgress })
                .from(dailyBriefs)
                .where(eq(dailyBriefs.id, briefId));
        assert.equal((failed?.progress as Record<string, unknown>)["recoveryAttempts"], 2);
        await reset(5);
        const result = await recover(async () => {
          sends++;
        });
        assert.equal(result.exhausted, 1);
        assert.equal(sends, 2);
        await queue(kind);
        await jobs[kind](provider());
      },
    );
  }

  await check(
    "brief lexical search: Azerbaijani NFC, AND terms across title/body, distinct i/ı",
    async () => {
      await db
        .update(dailyBriefs)
        .set({
          title: "Ə İ I Ş Ç Ğ Ö Ü",
          body: "mətn ayrı hissələrdə sınaq alfa beta",
          indexStatus: "queued",
        })
        .where(eq(dailyBriefs.id, briefId));
      for (const query of [
        "ə i ı ş ç ğ ö ü",
        "Ü ö Ğ ç Ş I İ Ə",
        "beta alfa",
        "Ə mətn",
        "O\u0308 U\u0308",
      ]) {
        const matches = await withCurrentUser(owner, () =>
          db
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(
              and(
                eq(dailyBriefs.id, briefId),
                ...buildBriefListConditions({ query, period: "all", month: "", cursor: null }),
              ),
            ),
        );
        assert.equal(matches.length, 1);
      }
      assert.notEqual(buildBriefSearchQuery("İ"), buildBriefSearchQuery("I"));
      const missing = await withCurrentUser(owner, () =>
        db
          .select({ id: dailyBriefs.id })
          .from(dailyBriefs)
          .where(
            and(
              eq(dailyBriefs.id, briefId),
              ...buildBriefListConditions({
                query: "alfa missingterm",
                period: "all",
                month: "",
                cursor: null,
              }),
            ),
          ),
      );
      assert.equal(missing.length, 0);
    },
  );

  await check(
    "authorization: low-clearance owner and administrator cannot read a secret document",
    async () => {
      for (const user of [owner, lowAdmin]) {
        const visible = await db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.id, documentIds[1]!), documentAccessFilter(user)));
        assert.equal(visible.length, 0);
      }
      assert.equal(
        (
          await db
            .select({ id: documents.id })
            .from(documents)
            .where(and(eq(documents.id, documentIds[1]!), documentAccessFilter(highUser)))
        ).length,
        1,
      );
    },
  );

  await check(
    "mutations: clearance and live role guard direction, retry and deletion predicates",
    async () => {
      for (const user of [owner, lowAdmin]) {
        const changed = await db
          .update(documents)
          .set({ direction: "IMINT" })
          .where(and(eq(documents.id, documentIds[1]!), documentManagementFilter(user)))
          .returning({ id: documents.id });
        assert.equal(changed.length, 0);
        const deleted = await db
          .delete(documents)
          .where(and(eq(documents.id, documentIds[1]!), documentManagementFilter(user)))
          .returning({ id: documents.id });
        assert.equal(deleted.length, 0);
      }
      // A stale admin context cannot manage another user's open document.
      await db.update(appUsers).set({ role: "user" }).where(eq(appUsers.id, lowAdmin.id));
      try {
        const changed = await db
          .update(documents)
          .set({ status: "queued" })
          .where(and(eq(documents.id, documentIds[0]!), documentManagementFilter(lowAdmin)))
          .returning({ id: documents.id });
        assert.equal(changed.length, 0);
        await assert.rejects(() => withCurrentUser(lowAdmin, () => removeBrief(briefId)));
        await assert.rejects(() =>
          withCurrentUser(lowAdmin, () =>
            saveBriefRecord(
              {
                briefId,
                isNew: false,
                status: "published",
                title: "Demoted actor must not change this",
                body: "Synthetic",
                date: getBakuDate(),
                keepAttachmentIds: [],
                uploads: [],
              },
              { sendIndexing: async () => undefined },
            ),
          ),
        );
      } finally {
        await db.update(appUsers).set({ role: "admin" }).where(eq(appUsers.id, lowAdmin.id));
      }
      // Allowed ownership still works with the live DB predicate.
      const changed = await db
        .update(documents)
        .set({ direction: "OSINT" })
        .where(and(eq(documents.id, documentIds[0]!), documentManagementFilter(owner)))
        .returning({ id: documents.id });
      assert.equal(changed.length, 1);
    },
  );

  await check(
    "citations: current chunk ownership, exact text and live clearance revalidation",
    async () => {
      await processDocumentJob(documentIds[1]!, { embeddings: provider() });
      const [chunk] = await db
        .select()
        .from(chunks)
        .where(eq(chunks.documentId, documentIds[1]!))
        .limit(1);
      assert.ok(chunk);
      const source: AnalyticsSource = {
        n: 1,
        sourceKind: "document",
        documentId: documentIds[1]!,
        briefId: null,
        chunkId: chunk.id,
        title: "Release probe document",
        docDate: null,
        briefDate: null,
        direction: "OSINT",
        sectionTitle: chunk.sectionTitle,
        text: chunk.text,
        quote: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        isTable: false,
        attachmentCount: 0,
        sourceReliability: "F",
        infoCredibility: 6,
        classification: "secret",
      };
      assert.equal((await recheckAnalyticsSourceAccess([source], lowAdmin.id)).length, 0);
      assert.equal((await recheckAnalyticsSourceAccess([source], highUser.id)).length, 1);
      assert.equal(
        (
          await recheckAnalyticsSourceAccess(
            [{ ...source, chunkId: crypto.randomUUID() }],
            highUser.id,
          )
        ).length,
        0,
      );
      assert.equal(
        (await recheckAnalyticsSourceAccess([{ ...source, text: "fabricated" }], highUser.id))
          .length,
        0,
      );
      await db.update(appUsers).set({ clearance: "open" }).where(eq(appUsers.id, highUser.id));
      assert.equal((await recheckAnalyticsSourceAccess([source], highUser.id)).length, 0);
      await db.update(appUsers).set({ clearance: "special" }).where(eq(appUsers.id, highUser.id));
    },
  );

  await check(
    "history: administrator clearance filters list metadata and direct records",
    async () => {
      await db.insert(analyticsQueries).values({
        id: historyId,
        createdBy: highUser.id,
        query: "Synthetic restricted history",
        filters: {
          period: "all",
          directionIds: [...directionIds],
          minSourceReliability: "all",
          minInfoCredibility: "all",
        },
        maxClassification: "secret",
        sources: [],
        status: "done",
      });
      assert.equal(
        (await withCurrentUser(lowAdmin, listAnalyticsHistory)).some((row) => row.id === historyId),
        false,
      );
      assert.equal(
        await withCurrentUser(lowAdmin, () => getAnalyticsHistoryRecord(historyId)),
        null,
      );
      assert.ok(await withCurrentUser(highUser, () => getAnalyticsHistoryRecord(historyId)));
    },
  );
  await check(
    "history: live administrator demotion rejects stale-session access to another author",
    async () => {
      await db
        .update(analyticsQueries)
        .set({ maxClassification: "open" })
        .where(eq(analyticsQueries.id, historyId));
      assert.ok(await withCurrentUser(lowAdmin, () => getAnalyticsHistoryRecord(historyId)));
      await db.update(appUsers).set({ role: "user" }).where(eq(appUsers.id, lowAdmin.id));
      assert.equal(
        await withCurrentUser(lowAdmin, () => getAnalyticsHistoryRecord(historyId)),
        null,
      );
      assert.equal(
        (await withCurrentUser(lowAdmin, listAnalyticsHistory)).some((row) => row.id === historyId),
        false,
      );
      await db.update(appUsers).set({ role: "admin" }).where(eq(appUsers.id, lowAdmin.id));
    },
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      case: currentCase,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await db.delete(analyticsQueries).where(eq(analyticsQueries.id, historyId));
  await db.delete(documents).where(inArray(documents.id, documentIds));
  await db.delete(dailyBriefs).where(eq(dailyBriefs.id, briefId));
  await db.delete(appUsers).where(
    inArray(
      appUsers.id,
      users.map((user) => user.id),
    ),
  );
  const leftovers = await db.execute(
    sql`select (select count(*) from documents where id in (${documentIds[0]}::uuid, ${documentIds[1]}::uuid)) + (select count(*) from daily_briefs where id = ${briefId}::uuid) + (select count(*) from app_users where id in (${users[0]!.id}, ${users[1]!.id}, ${users[2]!.id})) as count`,
  );
  const result = {
    runId,
    capturedAt: new Date().toISOString(),
    checks,
    status: process.exitCode ? "FAIL" : "PASS",
    fixtureLeftovers: Number(leftovers[0]?.["count"] ?? -1),
    failureCase: process.exitCode ? currentCase : null,
  };
  assert.equal(result.fixtureLeftovers, 0);
  await writeFile(
    process.argv[2] ?? "docs/release/INDEXING_INTEGRATION.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
