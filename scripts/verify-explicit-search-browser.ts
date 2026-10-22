/** Desktop/mobile smoke of the built local app; invented records and session, no provider calls. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db";
import { appUsers, appSessions, dailyBriefs, documents } from "../src/server/db/schema";
import { az } from "../src/lib/i18n/az";
import { getBakuDate } from "../src/lib/briefs";
import { requireProjectEvaluationDatabase } from "../src/server/evaluation-safety";

requireProjectEvaluationDatabase();
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4175";
assert(["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname));
const db = getDb();
const runId = randomUUID();
const userId = `search-browser-${runId}`;
const briefId = randomUUID(),
  documentId = randomUUID();
const token = `explicitprobe${runId.replaceAll("-", "")}`;
const sessionToken = randomBytes(32).toString("base64url");
const browser = await chromium.launch({
  headless: true,
  ...(process.env["BROWSER_EXECUTABLE_PATH"]
    ? { executablePath: process.env["BROWSER_EXECUTABLE_PATH"] }
    : { channel: "msedge" }),
});
const checks: string[] = [];
const httpFailures: { status: number; path: string }[] = [];
let activePage: import("playwright-core").Page | undefined;
let stage = "setup";
try {
  await db.insert(appUsers).values({
    id: userId,
    username: token,
    passwordHash: "disabled-synthetic",
    role: "admin",
    clearance: "special",
  });
  await db.insert(appSessions).values({
    userId,
    tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  await db.insert(dailyBriefs).values({
    id: briefId,
    briefDate: getBakuDate(),
    title: token,
    body: `${token} invented bulletin.`,
    classification: "secret",
    authorId: userId,
    indexStatus: "ready",
  });
  await db.insert(documents).values({
    id: documentId,
    ownerId: userId,
    title: token,
    body: `${token} invented document.`,
    classification: "open",
    status: "ready",
    chunkCount: 1,
    step: "ready",
    direction: "OSINT",
  });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "analitika_session", value: sessionToken, url: baseUrl }]);
    const page = await context.newPage();
    page.on("response", (response) => {
      if (response.status() >= 500)
        httpFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    });
    activePage = page;
    for (const [path, label] of [
      ["/", az.briefs.searchLabel],
      ["/senedler", az.documentLibrary.search],
    ] as const) {
      stage = `${width}:${path}`;
      await page.goto(baseUrl + path);
      const input = page.getByRole("textbox", { name: label });
      await input.waitFor();
      await page.waitForLoadState("networkidle");
      const calls: string[] = [];
      const onRequest = (request: import("playwright-core").Request) => {
        if (request.url().includes("_serverFn") && request.method() === "GET")
          calls.push(request.url());
      };
      page.on("request", onRequest);
      await input.fill(token);
      await page.waitForTimeout(450);
      assert.equal(calls.length, 0, "Typing must not search.");
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("_serverFn") && response.request().method() === "GET",
        ),
        input.press("Enter"),
      ]);
      await page.waitForLoadState("networkidle");
      assert.equal(calls.length, 1, "Enter must send one search.");
      await page.getByRole("link", { name: token, exact: false }).first().waitFor();
      await page.getByRole("button", { name: az.actions.search, exact: true }).click();
      await page.waitForTimeout(450);
      assert.equal(calls.length, 1, "Repeated submission must not duplicate a fresh request.");
      await input.fill(`${token} absentword`);
      await page.waitForTimeout(450);
      assert.equal(calls.length, 1);
      await page.getByRole("button", { name: az.actions.search, exact: true }).click();
      await page
        .getByText(path === "/" ? az.briefs.noMatches : az.documentLibrary.noMatches, {
          exact: true,
        })
        .waitFor();
      assert.equal(calls.length, 2, "Axtar must submit the new text once.");
      await input.fill("");
      await page.waitForTimeout(450);
      assert.equal(calls.length, 2);
      await input.press("Enter");
      await page.getByRole("link", { name: token, exact: false }).first().waitFor();
      assert(await page.getByRole("button", { name: az.actions.search }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      page.off("request", onRequest);
      checks.push(
        `${width}px ${path}: no requests on typing/clearing, Enter and Axtar, no duplicate submit, empty catalog reset, keyboard and overflow`,
      );
    }
    stage = `${width}:editor`;
    await page.goto(`${baseUrl}/brifler/yeni`);
    await page.locator('input[name="classification"][value="open"]').waitFor({ state: "attached" });
    assert(await page.locator('input[name="classification"][value="open"]').isChecked());
    await page.getByText(az.documents.classification.secret, { exact: true }).first().click();
    assert(await page.locator('input[name="classification"][value="secret"]').isChecked());
    await page.goto(`${baseUrl}/brifler/${briefId}/redakte`);
    stage = `${width}:editor-current`;
    await page
      .locator('input[name="classification"][value="secret"]')
      .waitFor({ state: "attached" });
    assert(await page.locator('input[name="classification"][value="secret"]').isChecked());
    await page
      .locator("label")
      .filter({ has: page.locator('input[name="classification"][value="top_secret"]') })
      .click();
    stage = `${width}:editor-save`;
    await page.getByRole("button", { name: az.briefs.save, exact: true }).click();
    await page.waitForURL(`${baseUrl}/brifler/${briefId}`, { timeout: 60_000 });
    await page.getByRole("heading", { name: token, exact: true, level: 1 }).waitFor();
    await page.getByText(az.documents.classification.top_secret, { exact: true }).waitFor();
    const [saved] = await db.select().from(dailyBriefs).where(eq(dailyBriefs.id, briefId));
    assert.equal(saved!.classification, "top_secret");
    assert.equal(saved!.indexStatus, "ready");
    await db
      .update(dailyBriefs)
      .set({ classification: "secret" })
      .where(eq(dailyBriefs.id, briefId));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    checks.push(
      `${width}px: create open default, classification choice/preview, edit current classification, save and detail badge, no reindex`,
    );
    await context.close();
  }
  assert.deepEqual(httpFailures, [], "Unexpected server error responses during browser smoke.");
  console.log(JSON.stringify({ status: "PASS", checks }));
} catch (error) {
  await activePage
    ?.screenshot({ path: ".release-backup.local/explicit-search-failure.png", fullPage: true })
    .catch(() => {});
  console.error(
    JSON.stringify({
      status: "FAIL",
      stage,
      errorType: error instanceof Error ? error.name : "unknown",
      reason: error instanceof Error ? error.message.split("\n")[0] : "Browser action failed.",
      httpFailures,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.delete(dailyBriefs).where(eq(dailyBriefs.id, briefId));
  await db.delete(documents).where(eq(documents.id, documentId));
  await db.delete(appUsers).where(inArray(appUsers.id, [userId]));
  await closeDb();
}
if (!process.exitCode)
  await writeFile(
    "docs/release/EXPLICIT_SEARCH_BROWSER.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        status: "PASS",
        checks,
        fixtureCleanup: "PASS",
        httpFailures,
      },
      null,
      2,
    ) + "\n",
  );
