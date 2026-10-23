/** Only local production UI + synthetic transport. Never imports server routes or clients. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { az } from "../src/lib/i18n/az";

const checks: string[] = [];
const errors: string[] = [];
const externalRequests: string[] = [];
const server = await createServer({
  configFile: false,
  envDir: false,
  appType: "custom",
  root: process.cwd(),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@/lib/briefs.functions",
        replacement: path.resolve("scripts/fixtures/phase-4-services.ts"),
      },
      {
        find: "@/lib/documents.functions",
        replacement: path.resolve("scripts/fixtures/phase-4-services.ts"),
      },
      {
        find: "@/lib/analytics.functions",
        replacement: path.resolve("scripts/fixtures/phase-4-services.ts"),
      },
      {
        find: "@/lib/auth.functions",
        replacement: path.resolve("scripts/fixtures/phase-4-services.ts"),
      },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
server.middlewares.use(async (request, response, next) => {
  if (request.url?.split("?")[0] !== "/__phase4") return next();
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    await server.transformIndexHtml(
      "/__phase4",
      '<!doctype html><html lang="az"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/phase-4-ui.tsx"></script></body></html>',
    ),
  );
});
let browser;
let failure: string | undefined;
try {
  await mkdir(".release-backup.local/phase-4", { recursive: true });
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env["BROWSER_EXECUTABLE_PATH"]
      ? { executablePath: process.env["BROWSER_EXECUTABLE_PATH"] }
      : { channel: "msedge" }),
  });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        externalRequests.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/__phase4`);
    const call = (method: string, value?: unknown) =>
      page.evaluate(
        ({ method, value }) => {
          const api = (
            window as unknown as { phase4: Record<string, (value?: unknown) => unknown> }
          ).phase4;
          return api[method]!(value);
        },
        { method, value },
      );
    const label = mobile ? "mobile" : "desktop";
    await page.getByLabel(az.analytics.questionLabel).fill("Sintetik analitik sual");
    await page.getByRole("button", { name: az.analytics.searchButton, exact: true }).click();
    await page.locator('.analytics-progress[data-stage="starting"]').waitFor();
    await call("emit", { type: "progress", stage: "retrieval" });
    await page.locator('.analytics-progress[data-stage="retrieval"]').waitFor();
    await call("emit", { type: "delta", text: "PRIVATE_DRAFT" });
    assert.equal(await page.getByText("PRIVATE_DRAFT").count(), 0);
    await call("emit", {
      type: "sources",
      sources: [
        {
          n: 1,
          sourceKind: "document",
          documentId: "00000000-0000-4000-8000-000000000001",
          briefId: null,
          chunkId: "synthetic-chunk",
          title: "Sintetik mənbə",
          sectionTitle: "Bölmə",
          quote: "Sintetik açıq mənbə fraqmenti.",
          docDate: "2026-10-22",
          briefDate: null,
          direction: "OSINT",
          classification: "open",
          sourceReliability: "A",
          infoCredibility: 1,
          isTable: false,
          attachmentCount: 0,
        },
      ],
    });
    await page.getByText("Sintetik mənbə", { exact: true }).waitFor();
    await call("emit", { type: "progress", stage: "generation" });
    await page.locator('.analytics-progress[data-stage="generation"]').waitFor();
    assert.equal(
      await page
        .locator(".analytics-progress")
        .evaluate((node) => node.closest('[aria-busy="true"]') === null),
      true,
    );
    assert.equal(await page.locator('[data-state="complete"]').count(), 2);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const cancel = page.getByRole("button", { name: az.analytics.cancel });
    assert.ok((await cancel.boundingBox())!.height >= 44);
    await page.screenshot({
      path: `.release-backup.local/phase-4/${label}-progress.png`,
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator('[data-state="active"] .analytics-progress-dot')
        .evaluate((node) => getComputedStyle(node, "::after").animationName),
      "none",
    );
    checks.push(
      `${label}: real stages, authorized sources during generation, no draft, responsive layout, 44px cancel, reduced motion`,
    );
    await call("emit", { type: "progress", stage: "validation" });
    await call("emit", { type: "progress", stage: "generation" });
    await page.locator('.analytics-progress[data-stage="generation"]').waitFor();
    await call("emit", { type: "final", answer: "Yoxlanmış sintetik cavab.", durationMs: 1000 });
    await page.getByText("Yoxlanmış sintetik cavab.").waitFor();
    assert.equal(await page.locator(".analytics-progress").count(), 0);
    // Final must release UI even before the SSE connection closes/history persistence finishes.
    assert.equal(
      await page.getByRole("button", { name: az.analytics.regenerate }).isEnabled(),
      true,
    );
    await call("close");
    checks.push(`${label}: validation retry and immediate final publication`);
    const a = page.getByRole("button", { name: /Sintetik sorğu A/ });
    const b = page.getByRole("button", { name: /Sintetik sorğu B/ });
    await a.click();
    assert.equal(await a.getAttribute("aria-current"), "true");
    assert.equal(await page.getByText("Yoxlanmış sintetik cavab.").count(), 0);
    await page.getByRole("status", { name: az.analytics.historyLoading }).waitFor();
    await b.click();
    await call("finishHistory", "B");
    await page.getByText("Sintetik cavab B.").waitFor();
    await call("finishHistory", "A");
    assert.equal(await b.getAttribute("aria-current"), "true");
    assert.equal(await page.getByText("Sintetik cavab A.").count(), 0);
    assert.ok(Number(await call("aborted")) >= 1);
    await page.screenshot({
      path: `.release-backup.local/phase-4/${label}-history.png`,
      fullPage: true,
    });
    checks.push(`${label}: immediate history selection, skeleton, latest wins after late response`);
    await page.getByRole("button", { name: az.analytics.regenerate }).click();
    await page.locator(".analytics-progress").waitFor();
    await page.getByRole("button", { name: az.analytics.cancel }).click();
    await page.getByRole("alert").filter({ hasText: az.analytics.cancelled }).waitFor();
    await page.getByRole("button", { name: az.actions.retry, exact: true }).click();
    await page.locator(".analytics-progress").waitFor();
    await call("emit", { type: "error", message: az.analytics.searchFailed });
    await page.getByRole("alert").filter({ hasText: az.analytics.searchFailed }).waitFor();
    assert.equal(await page.locator(".analytics-progress").count(), 0);
    await call("close");
    checks.push(`${label}: cancel, retry and terminal error release pending`);
    const nav = page
      .getByRole("navigation", { name: az.navigation.primary })
      .getByRole("link", { name: az.navigation.dailyBriefs });
    await nav.focus();
    await page.keyboard.press("Enter");
    await page.locator('.zirve-loader-page[data-visible="true"]').waitFor();
    assert.equal(
      await page.getByRole("navigation", { name: az.navigation.primary }).isVisible(),
      true,
    );
    await call("releaseRoute");
    await page.getByTestId("loaded-route").waitFor();
    assert.equal(await page.locator(".zirve-loader-page").count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    checks.push(`${label}: keyboard route transition preserves sidebar and completes immediately`);
    const finish = (name: string, value: unknown) => call("finish", { name, value });
    const waitPending = (name: string) =>
      page.waitForFunction(
        (name) =>
          (window as unknown as { phase4: { count: (name: string) => number } }).phase4.count(
            name,
          ) > 0,
        name,
      );
    const noOverflow = async () =>
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    for (const documents of [false, true]) {
      const name = documents ? "documents" : "briefs";
      await page.goto(`${origin}/__phase4?view=${documents ? "/senedler" : "/briefs"}`);
      await waitPending(name);
      assert.equal(await page.locator(".zirve-skeleton").count(), 6);
      const item = documents
        ? {
            id: "synthetic-doc",
            title: "Sintetik sənəd QA",
            docDate: "2026-10-22",
            createdAt: "2026-10-22T12:00:00Z",
            direction: "OSINT",
            classification: "open",
            status: "ready",
            preview: "Təcrid edilmiş sınaq mətni.",
            hasAttachments: false,
            canManage: false,
          }
        : {
            id: "synthetic-brief",
            title: "İnformasiya bülleteni",
            date: "2026-10-22",
            summary: "Təcrid edilmiş sınaq xülasəsi.",
            classification: "open",
          };
      const payload = {
        items: [item],
        nextCursor: documents
          ? { createdAt: "2026-10-22T12:00:00Z", id: item.id }
          : { date: "2026-10-22", id: item.id },
      };
      await finish(name, payload);
      const title = page.getByRole("heading", { name: item.title, exact: true });
      await title.waitFor();
      assert.equal(
        await page.getByRole("link").filter({ hasText: item.title }).getAttribute("href"),
        documents ? "/senedler/synthetic-doc" : "/brifler/synthetic-brief",
      );
      const before = await title.boundingBox();
      await call("invalidate", documents ? "documents" : "daily-briefs");
      await waitPending(name);
      assert.equal(await title.isVisible(), true);
      assert.equal(await page.locator(".zirve-skeleton").count(), 0);
      // Wait beyond the indicator threshold; reserved space must prevent content movement.
      await page.waitForTimeout(230);
      assert.ok(Math.abs((await title.boundingBox())!.y - before!.y) < 1);
      await finish(name, payload);
      const more = page.getByRole("button", {
        name: documents ? az.documentLibrary.loadMore : az.briefs.loadMore,
        exact: true,
      });
      await more.click();
      await waitPending(name);
      assert.equal(await page.locator('button[aria-busy="true"]').isDisabled(), true);
      assert.equal(await title.isVisible(), true);
      await finish(name, { items: [], nextCursor: null });
      await more.waitFor({ state: "detached" });
      await noOverflow();
      await page.screenshot({
        path: `.release-backup.local/phase-4/${label}-${name}.png`,
        fullPage: true,
      });
      const search = page.getByRole("textbox", {
        name: documents ? az.documentLibrary.search : az.briefs.searchLabel,
      });
      await search.fill("no-match");
      await search.press("Enter");
      await waitPending(name);
      await finish(name, { items: [], nextCursor: null });
      await page
        .getByText(documents ? az.documentLibrary.noMatches : az.briefs.noMatches, { exact: true })
        .waitFor();
      await call("invalidate", documents ? "documents" : "daily-briefs");
      await waitPending(name);
      await call("finish", { name, error: "Synthetic isolated failure" });
      await page.getByRole("alert").waitFor();
      await page.getByRole("button", { name: az.actions.retry, exact: true }).click();
      await waitPending(name);
      await finish(name, { items: [], nextCursor: null });
      await page.getByRole("alert").waitFor({ state: "detached" });
      checks.push(
        `${label}: actual ${name} initial skeleton, stable background data, local pagination, filtered empty, error/retry, no overflow`,
      );
    }
    await page.goto(`${origin}/__phase4?view=/ayarlar`);
    await waitPending("users");
    assert.ok((await page.locator(".zirve-skeleton").count()) > 0);
    await finish("users", [
      {
        id: "synthetic",
        username: "Test analitik",
        role: "admin",
        clearance: "special",
        active: true,
        createdAt: "2026-10-22T12:00:00Z",
      },
    ]);
    await page.getByRole("table").waitFor();
    const passwordForm = page.locator('section[aria-labelledby="own-password-heading"] form');
    const inputs = passwordForm.locator("input");
    await inputs.nth(0).fill("synthetic-current-password");
    await inputs.nth(1).fill("synthetic-new-password");
    await inputs.nth(2).fill("synthetic-new-password");
    const save = passwordForm.getByRole("button", {
      name: az.userManagement.changePassword,
      exact: true,
    });
    const buttonBox = await save.boundingBox();
    await save.click();
    await waitPending("password");
    assert.equal(await passwordForm.locator('button[type="submit"]').isDisabled(), true);
    assert.ok(
      Math.abs(
        (await passwordForm.locator('button[type="submit"]').boundingBox())!.width -
          buttonBox!.width,
      ) < 1,
    );
    await call("finish", { name: "password", error: "Synthetic rejection" });
    await passwordForm.getByRole("alert").waitFor();
    await noOverflow();
    await page.screenshot({
      path: `.release-backup.local/phase-4/${label}-settings.png`,
      fullPage: true,
    });
    checks.push(
      `${label}: actual settings initial skeleton, admin table, local mutation pending/error, stable button width, no overflow`,
    );
    await page.goto(`${origin}/__phase4?view=/login`);
    await page.getByLabel(az.auth.username, { exact: true }).fill("synthetic");
    await page.getByLabel(az.auth.password, { exact: true }).fill("synthetic-password");
    const login = page.getByRole("button", { name: az.auth.signIn, exact: true });
    await login.focus();
    await page.keyboard.press("Enter");
    await waitPending("login");
    assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
    await finish("login", { status: 401 });
    await page.getByRole("alert").filter({ hasText: az.auth.invalidCredentials }).waitFor();
    await login.click();
    await waitPending("login");
    await finish("login", { status: 429 });
    await page.getByRole("alert").filter({ hasText: az.auth.rateLimited }).waitFor();
    assert.equal(await login.isEnabled(), true);
    await noOverflow();
    await page.screenshot({
      path: `.release-backup.local/phase-4/${label}-login.png`,
      fullPage: true,
    });
    checks.push(
      `${label}: actual login keyboard submit, pending, invalid credentials/rate limit, retry release, no overflow`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page
      .screenshot({ path: ".release-backup.local/phase-4/browser-failure.png", fullPage: true })
      .catch(() => {});
    await writeFile(
      ".release-backup.local/phase-4/browser-failure.txt",
      await page
        .locator("body")
        .innerText()
        .catch(() => "unavailable"),
    );
  }
} finally {
  await browser?.close();
  await server.close();
  await writeFile(
    "docs/release/PHASE_4_BROWSER.json",
    JSON.stringify(
      {
        status: failure ? "FAIL" : "PASS",
        checks,
        errors,
        externalRequests,
        failure: failure ?? null,
        isolation:
          "Local Vite component harness; server functions replaced; synthetic fetch only; no DB/AI/S3/Inngest",
      },
      null,
      2,
    ) + "\n",
  );
}
if (failure) throw new Error(failure);
console.log(`PASS: ${checks.length} isolated browser checks`);
