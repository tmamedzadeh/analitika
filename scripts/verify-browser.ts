/** Real browser smoke against a local server and the configured DB; only scoped synthetic fixtures are written. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { and, eq, inArray, or } from "drizzle-orm";
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
import { hashPassword } from "../src/server/auth/password";
import { processDocumentJob } from "../src/server/jobs/process-document";
import { az } from "../src/lib/i18n/az";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";
import { getStorage, closeStorage } from "../src/server/storage/s3";
import { isOwnedImageUploadKey } from "../src/server/storage/image-uploads";

requireProjectEvaluationDatabase();
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4175";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname))
  throw new Error("Browser release verification requires a local server.");
const db = getDb();
const runId = crypto.randomUUID();
const token = `rcprobe${runId.replaceAll("-", "")}`;
const password = randomBytes(24).toString("base64url");
const userId = `browser-${runId}`;
const username = `browser_${runId.slice(0, 8)}`;
const managedUsername = `browser_managed_${runId.slice(0, 8)}`;
const secretDocumentId = crypto.randomUUID();
const title = `Release browser ${token}`;
const body = `# Release browser verification\n${token} identifies this synthetic test. The synthetic sample contains 42 units. No real-world assertion is made.`;
const checks: Array<{ name: string; status: "PASS" }> = [];
const fixtureStorageKeys = new Set<string>();
const photo = {
  name: "synthetic.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7R8AAAAASUVORK5CYII=",
    "base64",
  ),
};
const createdDocumentIds: string[] = [secretDocumentId];
const createdBriefIds: string[] = [];
let browser: Browser | undefined;
let activePage: Page | undefined;
const loginStatuses: number[] = [];
let loginPhase = "not-started";
let actionPhase = "setup";
const failedHttp: Array<{ path: string; status: number }> = [];
let currentCase = "setup";
async function check(name: string, test: () => Promise<void>) {
  currentCase = name;
  await test();
  checks.push({ name, status: "PASS" });
  console.log(`PASS: ${name}`);
}

try {
  await db.insert(appUsers).values({
    id: userId,
    username,
    passwordHash: await hashPassword(password),
    role: "admin",
    clearance: "open",
  });
  await db.insert(documents).values({
    id: secretDocumentId,
    ownerId: userId,
    title: "Restricted browser fixture",
    body: "Synthetic restricted marker never rendered to this user.",
    classification: "secret",
    status: "queued",
    direction: "OSINT",
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env["BROWSER_EXECUTABLE_PATH"]
      ? { executablePath: process.env["BROWSER_EXECUTABLE_PATH"]! }
      : { channel: "msedge" }),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  activePage = page;
  page.on("request", (request) => {
    if (request.method() !== "PUT") return;
    const match = /\/(documents|briefs)\/([0-9a-f-]{36})\/uploads\/[^/]+\/[^/]+$/.exec(
      decodeURIComponent(new URL(request.url()).pathname),
    );
    if (!match) return;
    const key = match[0].slice(1);
    if (isOwnedImageUploadKey(match[1] as "documents" | "briefs", match[2]!, userId, key))
      fixtureStorageKeys.add(key);
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/auth/login")
      loginStatuses.push(response.status());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedHttp.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.setDefaultTimeout(30_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.name));

  await check("anonymous routes redirect to login and data APIs reject access", async () => {
    await page.goto(`${baseUrl}/senedler`);
    await page.waitForURL(/\/login/);
    assert.equal((await context.request.get(`${baseUrl}/api/analytics/search`)).status(), 401);
    assert.equal(
      (
        await context.request.post(`${baseUrl}/api/auth/login`, {
          headers: { origin: "https://untrusted.invalid" },
          data: { username, password },
        })
      ).status(),
      403,
    );
  });
  await check(
    "real login rejects bad password, establishes HttpOnly SameSite session",
    async () => {
      await page.waitForLoadState("networkidle");
      loginPhase = "bad-password";
      await page.locator('input[name="username"]').fill(username);
      await page.locator('input[name="password"]').fill("incorrect-password");
      await page.getByRole("button", { name: az.auth.signIn, exact: true }).click();
      await page.getByText(az.auth.invalidCredentials, { exact: true }).waitFor();
      loginPhase = "valid-password";
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: az.auth.signIn, exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/senedler", { timeout: 60_000 });
      await page.locator('input[name="title"]').waitFor();
      const cookie = (await context.cookies()).find((entry) => entry.name === "analitika_session");
      assert.ok(cookie?.httpOnly);
      assert.equal(cookie.sameSite, "Lax");
    },
  );
  await check(
    "document create, durable queue, loading state and direct recent-document navigation",
    async () => {
      actionPhase = "document form input";
      await page.locator('input[name="title"]').fill(title);
      await page.locator('textarea[name="body"]').fill(body);
      await page.locator('select[name="direction"]').selectOption("OSINT");
      await page.locator('input[type="file"]').setInputFiles(photo);
      actionPhase = "document form submit";
      await page.getByRole("button", { name: az.documents.form.save, exact: true }).click();
      await page
        .getByText(az.documents.form.success, { exact: true })
        .or(page.getByText(az.documents.form.savedQueuePending, { exact: true }))
        .waitFor({ timeout: 60_000 });
      actionPhase = "document DB readback";
      const [created] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.ownerId, userId), eq(documents.title, title)));
      assert.ok(created);
      createdDocumentIds.push(created.id);
      // Exercise the real local provider/worker path. Cloud delivery is audited separately.
      actionPhase = "document provider processing";
      await processDocumentJob(created.id);
      actionPhase = "document detail navigation";
      await page.getByRole("link", { name: title, exact: true }).click();
      await page.waitForURL(`**/senedler/${created.id}`);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      await page.getByText(`${token} identifies this synthetic test.`, { exact: false }).waitFor();
      const image = page.locator('img[src^="/api/attachments/document/"]').first();
      await image.waitFor();
      assert.equal(
        (await context.request.get(baseUrl + (await image.getAttribute("src")))).status(),
        200,
      );
    },
  );
  await check("owner/admin clearance cannot open a restricted document by UUID", async () => {
    await page.goto(`${baseUrl}/senedler/${secretDocumentId}`);
    await page.getByText(az.documents.missing, { exact: true }).first().waitFor();
    assert.equal(
      await page
        .getByText("Synthetic restricted marker never rendered to this user.", { exact: false })
        .count(),
      0,
    );
  });
  await check(
    "brief creation, detail/edit route, lexical AND search and empty search state",
    async () => {
      await page.goto(`${baseUrl}/brifler/yeni`);
      await page.getByLabel(az.briefs.titleField, { exact: true }).fill(title);
      await page.locator("textarea").fill(`${token} alfa beta. Synthetic brief with 42 units.`);
      await page.locator('input[type="file"]').setInputFiles(photo);
      await page.getByRole("button", { name: az.briefs.save, exact: true }).click();
      await page.waitForURL(/\/brifler\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      createdBriefIds.push(new URL(page.url()).pathname.split("/").at(-1)!);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      const image = page.locator('img[src^="/api/attachments/brief/"]').first();
      await image.waitFor();
      assert.equal(
        (await context.request.get(baseUrl + (await image.getAttribute("src")))).status(),
        200,
      );
      await page.goto(`${baseUrl}/brifler/${createdBriefIds[0]}/redakte`);
      await page.getByLabel(az.briefs.titleField, { exact: true }).waitFor();
      actionPhase = "brief edit submit";
      await page
        .locator("textarea")
        .fill(`${token} alfa beta. Updated synthetic brief with 43 units.`);
      await page.getByRole("button", { name: az.briefs.save, exact: true }).click();
      await page.waitForURL(/\/brifler\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      actionPhase = "brief edited detail readback";
      await page
        .locator("article")
        .filter({ hasText: "Updated synthetic brief with 43 units." })
        .waitFor({ timeout: 60_000 });
      await page.goto(baseUrl);
      await page.getByLabel(az.briefs.searchLabel).fill(`${token} beta alfa`);
      await page.getByRole("link", { name: title, exact: false }).first().waitFor();
      await page.getByLabel(az.briefs.searchLabel).fill(`${token} nonexistentword`);
      await page.getByText(az.briefs.noMatches, { exact: true }).waitFor();
    },
  );
  await check(
    "analytics real HTTP retrieval, source rendering, history and source navigation",
    async () => {
      actionPhase = "analytics HTTP retrieval";
      await page.goto(`${baseUrl}/axtaris`);
      const response = await context.request.post(`${baseUrl}/api/analytics/search`, {
        headers: { origin: baseUrl },
        data: {
          query: token,
          mode: "sources",
          filters: {
            period: "all",
            directionIds: ["OSINT"],
            minSourceReliability: "all",
            minInfoCredibility: "all",
          },
        },
        timeout: 90_000,
      });
      assert.equal(response.status(), 200);
      const stream = await response.text();
      assert.ok(stream.includes('"type":"sources"'));
      assert.ok(stream.includes('"type":"final"'));
      assert.ok(stream.includes(createdDocumentIds[1]!));
      actionPhase = "history reload";
      await page.reload();
      await page.getByRole("button", { name: token, exact: false }).first().waitFor();
      await page.getByRole("button", { name: token, exact: false }).first().click();
      actionPhase = "history source navigation";
      const sourceLink = page.locator(`a[href="/senedler/${createdDocumentIds[1]}"]`).first();
      await sourceLink.waitFor();
      const opened = context.waitForEvent("page");
      await sourceLink.click();
      const sourcePage = await opened;
      await sourcePage.getByRole("heading", { name: title, exact: true }).waitFor();
      await sourcePage.close();
    },
  );
  await check(
    "admin account creation, keyboard submit, clearance update and deactivation",
    async () => {
      await page.goto(`${baseUrl}/ayarlar`);
      const form = page.locator("form").filter({
        has: page.getByRole("button", { name: az.userManagement.createUser, exact: true }),
      });
      await form.locator("input").first().fill(managedUsername);
      await form.locator("input").first().press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), "SELECT");
      await form.locator('input[type="password"]').first().fill(password);
      await form.locator('input[type="password"]').last().fill(password);
      await form.locator('input[type="password"]').last().press("Enter");
      await page.getByText(az.userManagement.userCreated, { exact: true }).waitFor();
      const row = page.getByRole("row").filter({ hasText: managedUsername });
      await row.getByRole("combobox").selectOption("secret");
      await page.getByText(az.userManagement.clearanceSaved, { exact: true }).waitFor();
      page.once("dialog", (dialog) => dialog.accept());
      await row.getByRole("button", { name: az.userManagement.deactivate, exact: true }).click();
      await row.getByText(az.userManagement.inactive, { exact: true }).waitFor();
      const [record] = await db
        .select({ active: appUsers.active, clearance: appUsers.clearance })
        .from(appUsers)
        .where(eq(appUsers.username, managedUsername));
      assert.deepEqual(record, { active: false, clearance: "secret" });
    },
  );
  await check("administration, removed routes and responsive layout", async () => {
    await page.goto(`${baseUrl}/ayarlar`);
    await page.getByRole("heading", { name: az.userManagement.title, exact: true }).waitFor();
    for (const path of ["/osint", "/sorgu", `/sorgu/${runId}`]) {
      const response = await page.goto(baseUrl + path);
      assert.equal(response?.status(), 404);
    }
    await page.goto(`${baseUrl}/senedler/${createdDocumentIds[1]}`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: "docs/release/BROWSER_MOBILE.png", fullPage: true });
    for (const [path, name] of [
      ["/", "briefs"],
      ["/axtaris", "analytics"],
      ["/senedler", "documents"],
      ["/ayarlar", "settings"],
    ]) {
      await page.goto(baseUrl + path);
      await page.locator("h1").waitFor();
      if (path === "/") await page.locator('a[href^="/brifler/"]').first().waitFor();
      if (path === "/axtaris")
        await page.getByRole("button", { name: token, exact: false }).first().waitFor();
      if (path === "/senedler")
        await page.locator(`a[href="/senedler/${createdDocumentIds[1]}"]`).first().waitFor();
      if (path === "/ayarlar") await page.getByText(managedUsername, { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await page.screenshot({ path: `.release-backup.local/mobile-${name}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("session expiration redirects and logout revokes the session", async () => {
    await db
      .update(appSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(appSessions.userId, userId));
    await page.reload();
    await page.waitForURL(/\/login/);
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: az.auth.signIn, exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    await page
      .getByRole("button", { name: az.actions.logout, exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForURL(/\/login/);
    assert.equal(
      (await context.cookies()).some((entry) => entry.name === "analitika_session"),
      false,
    );
    assert.equal(
      (
        await db
          .select({ id: appSessions.id })
          .from(appSessions)
          .where(eq(appSessions.userId, userId))
      ).length,
      0,
    );
  });
  assert.deepEqual(browserErrors, []);
} catch (error) {
  await activePage
    ?.screenshot({ path: ".release-backup.local/browser-failure.png", fullPage: true })
    .catch(() => undefined);
  console.error(
    JSON.stringify({
      status: "FAIL",
      case: currentCase,
      errorType: error instanceof Error ? error.name : "unknown",
      errorSummary:
        error instanceof Error ? error.message.split("\n")[0]?.slice(0, 220) : "unknown",
      loginPhase,
      loginStatuses,
      pathname: activePage ? new URL(activePage.url()).pathname : null,
      actionPhase,
      failedHttp,
      knownFormError: activePage
        ? await (async () => {
            for (const [key, message] of Object.entries(az.documents.form)) {
              if (
                typeof message === "string" &&
                (await activePage!
                  .getByRole("alert")
                  .filter({ hasText: message })
                  .isVisible()
                  .catch(() => false))
              )
                return key;
            }
            return null;
          })()
        : null,
      networkErrorVisible: activePage
        ? await activePage
            .getByText(az.auth.networkError, { exact: true })
            .isVisible()
            .catch(() => false)
        : false,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  // Capture fixture IDs even if the browser fails immediately after a successful save.
  const extraDocs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.ownerId, userId));
  const extraBriefs = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(eq(dailyBriefs.authorId, userId));
  if (extraDocs.length) {
    const files = await db
      .select({ key: attachments.storageKey })
      .from(attachments)
      .where(
        inArray(
          attachments.documentId,
          extraDocs.map((row) => row.id),
        ),
      );
    files.forEach((file) => fixtureStorageKeys.add(file.key));
  }
  if (extraBriefs.length) {
    const files = await db
      .select({ key: briefAttachments.storageKey })
      .from(briefAttachments)
      .where(
        inArray(
          briefAttachments.briefId,
          extraBriefs.map((row) => row.id),
        ),
      );
    files.forEach((file) => fixtureStorageKeys.add(file.key));
  }
  if (extraDocs.length)
    await db.delete(documents).where(
      inArray(
        documents.id,
        extraDocs.map((row) => row.id),
      ),
    );
  if (extraBriefs.length)
    await db.delete(dailyBriefs).where(
      inArray(
        dailyBriefs.id,
        extraBriefs.map((row) => row.id),
      ),
    );
  await db.delete(analyticsQueries).where(eq(analyticsQueries.createdBy, userId));
  await db.delete(appUsers).where(eq(appUsers.username, managedUsername));
  await db.delete(appUsers).where(eq(appUsers.id, userId));
  const fixtureDocumentIds = [
    ...new Set([...createdDocumentIds, ...extraDocs.map((row) => row.id)]),
  ];
  const fixtureBriefIds = [...new Set([...createdBriefIds, ...extraBriefs.map((row) => row.id)])];
  const leftovers = await Promise.all([
    db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, userId)),
    db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.username, managedUsername)),
    db.select({ id: appSessions.id }).from(appSessions).where(eq(appSessions.userId, userId)),
    db.select({ id: documents.id }).from(documents).where(eq(documents.ownerId, userId)),
    db.select({ id: dailyBriefs.id }).from(dailyBriefs).where(eq(dailyBriefs.authorId, userId)),
    db
      .select({ id: analyticsQueries.id })
      .from(analyticsQueries)
      .where(eq(analyticsQueries.createdBy, userId)),
    db
      .select({ id: chunks.id })
      .from(chunks)
      .where(
        or(
          inArray(chunks.documentId, fixtureDocumentIds),
          ...(fixtureBriefIds.length ? [inArray(chunks.briefId, fixtureBriefIds)] : []),
        ),
      ),
  ]);
  const fixtureLeftovers = leftovers.reduce((total, rows) => total + rows.length, 0);
  assert.equal(fixtureLeftovers, 0);
  for (const key of fixtureStorageKeys) {
    await getStorage().delete(key);
    await assert.rejects(getStorage().getMetadata(key));
  }
  const result = {
    checkedAt: new Date().toISOString(),
    target: new URL(baseUrl).origin,
    artifactSha256: createHash("sha256")
      .update(await readFile(".vercel/output/functions/__server.func/index.mjs"))
      .digest("hex"),
    checks,
    status: process.exitCode ? "FAIL" : "PASS",
    failureCase: process.exitCode ? currentCase : null,
    fixtureCleanup: "completed",
    fixtureLeftovers,
    storageFixtureCleanup: { keys: fixtureStorageKeys.size, absenceVerified: true },
    cloudWorkerDelivery: "NOT VERIFIED; local worker explicitly exercised",
  };
  await writeFile("docs/release/BROWSER_E2E.json", JSON.stringify(result, null, 2) + "\n");
  await closeDb();
  closeStorage();
  console.log(JSON.stringify(result, null, 2));
}
