// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import sharp from "sharp";
import { isolatedPostgres } from "@/test/isolated-postgres";
import { withCurrentUser, type SessionUser } from "../auth";
import { plainTextDocument } from "@/lib/rich-text";
import { createTextDocument, recoverCreation, type TextCreation } from "./creations";
import {
  issueDocumentImageUrl,
  finalizeDocumentImage,
  cancelDocumentImage,
  listDocumentImages,
} from "../storage/document-image-sessions";
import { claimImageObjectDeletion } from "../storage/cleanup-claims";
import type { StorageProvider } from "../storage/types";
import { ImageOperationError } from "../storage/operations";

const state = vi.hoisted(() => ({ db: undefined as unknown, storage: undefined as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../storage/s3", () => ({ getStorage: () => state.storage }));
const user: SessionUser = {
  id: "synthetic-owner",
  username: "synthetic",
  sessionId: "synthetic",
  role: "user",
  clearance: "secret",
};
const asUser = <T>(work: () => T) => withCurrentUser(user, work);
const suite = process.env["ZIRVE_ISOLATED_PG_TESTS"] === "1" ? describe : describe.skip;

suite("0029 and image lifecycle on verified isolated PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof isolatedPostgres>>;
  let bytes: Uint8Array;
  const memory = new Map<string, Uint8Array>();
  let lastStaging = "";
  let onPut: (() => Promise<void>) | undefined;
  const input = (): TextCreation => ({
    creationKey: crypto.randomUUID(),
    title: "Synthetic document",
    bodyRich: plainTextDocument("Synthetic text remains saved"),
    direction: "OSINT",
    classification: "secret",
    sourceReliability: "A",
    infoCredibility: 1,
    photos: [
      {
        clientFileId: crypto.randomUUID(),
        name: "synthetic.png",
        mime: "image/png",
        size: bytes.length,
      },
    ],
  });
  beforeAll(async () => {
    fixture = await isolatedPostgres();
    state.db = drizzle(fixture.client);
    bytes = new Uint8Array(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } })
        .png()
        .toBuffer(),
    );
  }, 30_000);
  beforeEach(async () => {
    await fixture.verify();
    await fixture.client`truncate image_upload_objects, document_image_uploads, document_creations, attachments, documents, app_users cascade`;
    await fixture.client`insert into app_users(id) values (${user.id})`;
    memory.clear();
    onPut = undefined;
    state.storage = {
      getSignedUploadUrl: async (key: string) => {
        lastStaging = key;
        return "https://synthetic.invalid/upload";
      },
      getObjectStream: async (key: string) => {
        const body = memory.get(key);
        if (!body) throw new Error("Synthetic missing object");
        return {
          size: body.length,
          contentType: "image/png",
          body: new ReadableStream({
            start(c) {
              c.enqueue(body);
              c.close();
            },
          }),
        };
      },
      put: async ({ key, body }: { key: string; body: Uint8Array }) => {
        memory.set(key, body.slice());
        await onPut?.();
      },
      delete: async (key: string) => {
        memory.delete(key);
      },
    } as unknown as StorageProvider;
  });
  afterAll(async () => {
    await fixture?.client.end();
  });

  async function prepared(data = input()) {
    const result = await asUser(() => createTextDocument(data));
    const [slot] = await asUser(() => listDocumentImages(result.documentId));
    const issued = await asUser(() => issueDocumentImageUrl(result.documentId, slot!.id));
    memory.set(lastStaging, bytes);
    return { data, documentId: result.documentId, slot: slot!, generation: issued.generation };
  }
  it("applies only additive tables with RLS and preserves the predecessor schema", async () => {
    const rows =
      await fixture.client`select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('document_creations','document_image_uploads','image_upload_objects')`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r["rowsecurity"])).toBe(true);
    expect(
      (
        await fixture.client`select count(*)::int as n from information_schema.columns where table_name='documents'`
      )[0]?.["n"],
    ).toBe(19);
  });
  it("serializes concurrent same-key creates and rejects a different payload", async () => {
    const data = input();
    const results = await asUser(() =>
      Promise.all([createTextDocument(data), createTextDocument(data)]),
    );
    expect(results[0]!.documentId).toBe(results[1]!.documentId);
    await expect(
      asUser(() => createTextDocument({ ...data, title: "Different" })),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(1);
  });
  it("recovers lost HTTP ACK by durable creation key without storage or reindex mutation", async () => {
    const data = input();
    const saved = await asUser(() => createTextDocument(data));
    const recovered = await asUser(() => recoverCreation(data.creationKey));
    expect(recovered?.documentId).toBe(saved.documentId);
    expect(memory.size).toBe(0);
    expect((await fixture.client`select body,status from documents`)[0]).toMatchObject({
      body: "Synthetic text remains saved",
      status: "queued",
    });
  });
  it("recovers a lost SQL COMMIT ACK after the actual commit", async () => {
    const base = state.db as ReturnType<typeof drizzle>;
    let lost = false;
    state.db = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "transaction")
          return async (work: Parameters<typeof base.transaction>[0]) => {
            const result = await target.transaction(work);
            if (!lost) {
              lost = true;
              throw new Error("Synthetic lost COMMIT ACK");
            }
            return result;
          };
        return Reflect.get(target, property, receiver);
      },
    });
    try {
      const data = input();
      const saved = await asUser(() => createTextDocument(data));
      expect(saved.replay).toBe(true);
      expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(1);
    } finally {
      state.db = base;
    }
  });
  it("recovers a lost finalization COMMIT ACK without deleting original bytes", async () => {
    const p = await prepared();
    const base = state.db as ReturnType<typeof drizzle>;
    let lost = false;
    state.db = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "transaction")
          return async (work: Parameters<typeof base.transaction>[0]) => {
            const result = await target.transaction(work);
            const [row] = await fixture.client`select count(*)::int as n from attachments`;
            if (row?.["n"] && !lost) {
              lost = true;
              throw new Error("Synthetic lost finalization COMMIT ACK");
            }
            return result;
          };
        return Reflect.get(target, property, receiver);
      },
    });
    try {
      expect(
        await asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
      ).toEqual({ state: "ready" });
      const [row] = await fixture.client`select storage_key from attachments`;
      expect(memory.get(row!["storage_key"])).toEqual(bytes);
      expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(1);
    } finally {
      state.db = base;
    }
  });
  it("finalizes once, preserves original bytes, and survives staging overwrite/replay", async () => {
    const p = await prepared();
    await asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation));
    const [file] = await fixture.client`select storage_key from attachments`;
    expect(memory.get(file!["storage_key"])).toEqual(bytes);
    memory.set(lastStaging, new Uint8Array([0]));
    await asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation));
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(1);
    expect(memory.get(file!["storage_key"])).toEqual(bytes);
    expect(
      await claimImageObjectDeletion(file!["storage_key"], new Date(Date.now() + 10 * 86400000)),
    ).toBe(false);
  });
  it("retains a committed original when both COMMIT ACK and recovery connection fail", async () => {
    const p = await prepared();
    const base = state.db as ReturnType<typeof drizzle>;
    let lost = false;
    let recoveryFailed = false;
    state.db = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "transaction")
          return async (work: Parameters<typeof base.transaction>[0]) => {
            const result = await target.transaction(work);
            const [row] = await fixture.client`select count(*)::int as n from attachments`;
            if (row?.["n"] && !lost) {
              lost = true;
              throw new Error("Synthetic lost COMMIT ACK");
            }
            return result;
          };
        if (property === "select" && lost && !recoveryFailed) {
          recoveryFailed = true;
          throw new Error("Synthetic recovery connection failure");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    try {
      await expect(
        asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
      ).rejects.toMatchObject({ code: "unknown" });
      const [row] = await fixture.client`select storage_key from attachments`;
      expect(memory.get(row!["storage_key"])).toEqual(bytes);
    } finally {
      state.db = base;
    }
    expect(
      await asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).toEqual({ state: "ready" });
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(1);
  });
  it("cancellation during PUT fences publication and leaves text intact", async () => {
    const p = await prepared();
    onPut = async () => {
      onPut = undefined;
      await asUser(() => cancelDocumentImage(p.documentId, p.slot.id));
    };
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(0);
    expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(1);
    expect((await asUser(() => listDocumentImages(p.documentId)))[0]?.state).toBe("cancelled");
  });
  it("rejects finalize after clearance revocation", async () => {
    const p = await prepared();
    await fixture.client`update app_users set clearance='open' where id=${user.id}`;
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(0);
  });
  it("retains protected objects and fences cleanup-claimed keys", async () => {
    const p = await prepared();
    expect(await claimImageObjectDeletion(lastStaging, new Date())).toBe(false);
    await fixture.client`update image_upload_objects set protect_until=now()-interval '1 day'`;
    await fixture.client`update document_image_uploads set state='cancelled'`;
    expect(await claimImageObjectDeletion(lastStaging, new Date())).toBe(true);
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toThrow();
  });
  it("expires and refreshes URLs on the same slot with a new fenced generation", async () => {
    const p = await prepared();
    const previous = lastStaging;
    const next = await asUser(() => issueDocumentImageUrl(p.documentId, p.slot.id));
    expect(next.generation).toBeGreaterThan(p.generation);
    expect(lastStaging).not.toBe(previous);
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("stores zero or ten images without changing the independently saved text", async () => {
    const empty = await asUser(() => createTextDocument({ ...input(), photos: [] }));
    expect(await asUser(() => listDocumentImages(empty.documentId))).toEqual([]);
    const data = input();
    data.photos = Array.from({ length: 10 }, () => ({
      ...data.photos[0]!,
      clientFileId: crypto.randomUUID(),
    }));
    const saved = await asUser(() => createTextDocument(data));
    const slots = await asUser(() => listDocumentImages(saved.documentId));
    for (const slot of slots) {
      const issued = await asUser(() =>
        issueDocumentImageUrl(saved.documentId, slot.id, slot.generation),
      );
      memory.set(lastStaging, bytes);
      await asUser(() => finalizeDocumentImage(saved.documentId, slot.id, issued.generation));
    }
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(10);
    expect(
      (await fixture.client`select body from documents where id=${saved.documentId}`)[0]?.["body"],
    ).toBe("Synthetic text remains saved");
  }, 20_000);
  it("concurrent finalize publishes one immutable attachment", async () => {
    const p = await prepared();
    const results = await asUser(() =>
      Promise.allSettled([
        finalizeDocumentImage(p.documentId, p.slot.id, p.generation),
        finalizeDocumentImage(p.documentId, p.slot.id, p.generation),
      ]),
    );
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(1);
  });
  it("storage timeout retains staging and permits a safe retry", async () => {
    const p = await prepared();
    const storage = state.storage as StorageProvider;
    const get = storage.getObjectStream;
    storage.getObjectStream = async () => {
      throw new ImageOperationError("timeout", true);
    };
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(memory.get(lastStaging)).toEqual(bytes);
    storage.getObjectStream = get;
    expect(
      await asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).toEqual({ state: "ready" });
  });
  it("reselects a corrected file on the same slot without replacing a published original", async () => {
    const p = await prepared();
    memory.set(lastStaging, new Uint8Array(bytes.length));
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "validation" });
    const corrected = new Uint8Array(
      await sharp({ create: { width: 32, height: 20, channels: 3, background: "blue" } })
        .png()
        .toBuffer(),
    );
    const issued = await asUser(() =>
      issueDocumentImageUrl(p.documentId, p.slot.id, p.generation, {
        name: "corrected.png",
        mime: "image/png",
        size: corrected.length,
      }),
    );
    memory.set(lastStaging, corrected);
    await asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, issued.generation));
    const [original] = await fixture.client`select storage_key from attachments`;
    expect(memory.get(original!["storage_key"])).toEqual(corrected);
    const again = await asUser(() =>
      issueDocumentImageUrl(p.documentId, p.slot.id, issued.generation, {
        name: "another.png",
        mime: "image/png",
        size: bytes.length,
      }),
    );
    expect(again.state).toBe("ready");
    expect(memory.get(original!["storage_key"])).toEqual(corrected);
  });
  it("rejecting one photo preserves text and previously verified photos", async () => {
    const data = input();
    data.photos.push({ ...data.photos[0]!, clientFileId: crypto.randomUUID() });
    const saved = await asUser(() => createTextDocument(data));
    const slots = await asUser(() => listDocumentImages(saved.documentId));
    for (const [index, slot] of slots.entries()) {
      const issued = await asUser(() => issueDocumentImageUrl(saved.documentId, slot.id));
      memory.set(lastStaging, index ? new Uint8Array(bytes.length) : bytes);
      const result = asUser(() =>
        finalizeDocumentImage(saved.documentId, slot.id, issued.generation),
      );
      if (index) await expect(result).rejects.toMatchObject({ code: "validation" });
      else await result;
    }
    const [attachment] = await fixture.client`select storage_key from attachments`;
    expect(memory.get(attachment!["storage_key"])).toEqual(bytes);
    expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(1);
  });
  it("delete during PUT prevents publication and replay cannot recreate the document", async () => {
    const p = await prepared();
    onPut = async () => {
      onPut = undefined;
      await fixture.client`delete from documents where id=${p.documentId}`;
    };
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(asUser(() => createTextDocument(p.data))).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(0);
    expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(0);
  });
  it("an expired lease and cleanup claim fence an in-flight candidate", async () => {
    const p = await prepared();
    onPut = async () => {
      onPut = undefined;
      await fixture.client`update document_image_uploads set expires_at=now()-interval '1 day',lease_until=now()-interval '1 second' where id=${p.slot.id}`;
      await fixture.client`update image_upload_objects set protect_until=now()-interval '1 day'`;
      const [candidate] =
        await fixture.client`select key from image_upload_objects where key like '%/committed/%' limit 1`;
      expect(await claimImageObjectDeletion(candidate!["key"], new Date())).toBe(true);
    };
    await expect(
      asUser(() => finalizeDocumentImage(p.documentId, p.slot.id, p.generation)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await fixture.client`select count(*)::int as n from attachments`)[0]?.["n"]).toBe(0);
  });
  it("enforces configurable pending quotas without losing text and retries after capacity is released", async () => {
    vi.stubEnv("IMAGE_UPLOAD_MAX_PENDING_FILES", "10");
    vi.stubEnv("IMAGE_UPLOAD_RETENTION_HOURS", "2");
    try {
      const first = input();
      first.photos = Array.from({ length: 10 }, () => ({
        ...first.photos[0]!,
        clientFileId: crypto.randomUUID(),
      }));
      const original = await asUser(() => createTextDocument(first));
      const blocked = await asUser(() => createTextDocument(input()));
      const [slot] = await asUser(() => listDocumentImages(blocked.documentId));
      expect(slot?.errorCode).toBe("quota");
      expect(Math.round((Date.parse(slot!.expiresAt) - Date.now()) / 3600_000)).toBe(2);
      for (const pending of await asUser(() => listDocumentImages(original.documentId)))
        await asUser(() =>
          cancelDocumentImage(original.documentId, pending.id, pending.generation),
        );
      expect(
        (await asUser(() => issueDocumentImageUrl(blocked.documentId, slot!.id, slot!.generation)))
          .state,
      ).toBe("uploading");
      expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("bounds a real PostgreSQL row-lock wait without inserting a partial document", async () => {
    let locked!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = fixture.client.begin(async (tx) => {
      await tx`select id from app_users where id=${user.id} for update`;
      locked();
      await hold;
    });
    await ready;
    const started = Date.now();
    try {
      await expect(asUser(() => createTextDocument(input()))).rejects.toMatchObject({
        code: "unknown",
      });
      expect(Date.now() - started).toBeLessThan(7000);
      expect((await fixture.client`select count(*)::int as n from documents`)[0]?.["n"]).toBe(0);
    } finally {
      release();
      await blocker;
    }
  });
});
