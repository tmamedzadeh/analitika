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
  envFile: false,
  appType: "custom",
  root: process.cwd(),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@/lib/analytics.functions",
        replacement: path.resolve("scripts/fixtures/phase-2b-services.ts"),
      },
      {
        find: "@/lib/auth.functions",
        replacement: path.resolve("scripts/fixtures/phase-2b-services.ts"),
      },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
server.middlewares.use(async (request, response, next) => {
  if (request.url?.split("?")[0] !== "/__phase2b") return next();
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    await server.transformIndexHtml(
      "/__phase2b",
      '<!doctype html><html lang="az"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/phase-2b-ui.tsx"></script></body></html>',
    ),
  );
});
let browser;
let failure: string | undefined;
try {
  await mkdir(".release-backup.local/phase-2b", { recursive: true });
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
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/__phase2b`);
    const call = (method: string, value?: unknown) =>
      page.evaluate(
        ({ method, value }) => {
          const api = (
            window as unknown as { phase2b: Record<string, (value?: unknown) => unknown> }
          ).phase2b;
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
      path: `.release-backup.local/phase-2b/${label}-progress.png`,
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
      path: `.release-backup.local/phase-2b/${label}-history.png`,
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
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  await browser?.close();
  await server.close();
  await writeFile(
    "docs/release/PHASE_2B_BROWSER.json",
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
