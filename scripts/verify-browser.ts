/** Real browser smoke against a local server and the configured DB; only scoped synthetic fixtures are written. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import {
  analyticsQueries,
  appSessions,
  appUsers,
  dailyBriefs,
  documents,
} from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { processDocumentJob } from "../src/server/jobs/process-document";
import { az } from "../src/lib/i18n/az";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";

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
const secretDocumentId = crypto.randomUUID();
const title = `Release browser ${token}`;
const body = `# Release browser verification\n${token} identifies this synthetic test. The synthetic sample contains 42 units. No real-world assertion is made.`;
const checks: Array<{ name: string; status: "PASS" }> = [];
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
      await page.getByRole("button", { name: az.briefs.save, exact: true }).click();
      await page.waitForURL(/\/brifler\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      createdBriefIds.push(new URL(page.url()).pathname.split("/").at(-1)!);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      await page.goto(`${baseUrl}/brifler/${createdBriefIds[0]}/redakte`);
      await page.getByLabel(az.briefs.titleField, { exact: true }).waitFor();
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
      await page.reload();
      await page.getByRole("button", { name: token, exact: false }).first().waitFor();
      await page.getByRole("button", { name: token, exact: false }).first().click();
      await page.locator(`a[href*="${createdDocumentIds[1]}"]`).first().waitFor();
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
  await db.delete(appUsers).where(eq(appUsers.id, userId));
  const result = {
    checkedAt: new Date().toISOString(),
    target: new URL(baseUrl).origin,
    checks,
    status: process.exitCode ? "FAIL" : "PASS",
    failureCase: process.exitCode ? currentCase : null,
    fixtureCleanup: "completed",
    cloudWorkerDelivery: "NOT VERIFIED; local worker explicitly exercised",
  };
  await writeFile("docs/release/BROWSER_E2E.json", JSON.stringify(result, null, 2) + "\n");
  await closeDb();
  console.log(JSON.stringify(result, null, 2));
}
