/** Isolated real-browser smoke of production analytics components, styles and synthetic data. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser, type Page } from "playwright-core";
import { az } from "../src/lib/i18n/az";
import { analyticsFragmentId } from "../src/lib/analytics";

const checks: Array<{ name: string; status: "PASS" }> = [];
const errors: string[] = [];
const externalRequests: string[] = [];
let browser: Browser | undefined;
let activePage: Page | undefined;
let currentCase = "setup";
let failure: string | null = null;
const server = await createServer({
  configFile: false,
  appType: "custom",
  root: process.cwd(),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve("src") } },
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
server.middlewares.use(async (request, response, next) => {
  if (request.url?.split("?")[0] !== "/__analytics_ui") return next();
  const html = await server.transformIndexHtml(
    "/__analytics_ui",
    '<!doctype html><html lang="az"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Analytics component browser smoke</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/analytics-ui.tsx"></script></body></html>',
  );
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
});

async function check(name: string, test: () => Promise<void>) {
  currentCase = name;
  await test();
  checks.push({ name, status: "PASS" });
  console.log(`PASS: ${name}`);
}

async function verifyLayout(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const ids = await page.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(new Set(ids).size, ids.length);
}

try {
  await mkdir(".release-backup.local", { recursive: true });
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
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
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copiedAnswer: string }).copiedAnswer = text;
          },
        },
      });
    });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== baseUrl) {
        externalRequests.push(new URL(route.request().url()).origin);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${baseUrl}/__analytics_ui`);
    const scope = page.getByTestId("history-a");
    const answer = page.getByTestId("answer-history-a");
    const card = scope.locator('article[data-source-group="document:same-parent"]');
    const toggle = card.getByRole("button", { name: az.analytics.toggleFragments });
    const trigger = answer.getByRole("link", { name: az.analytics.openSource.replace("{n}", "3") });
    const targetId = analyticsFragmentId("document:same-parent", 3, "history-a");
    const target = page.locator(`[id="${targetId}"]`);
    const label = mobile ? "mobile" : "desktop";

    await check(
      `${label}: identity grouping, compact defaults, unique IDs and no overflow`,
      async () => {
        await toggle.waitFor();
        assert.equal(await scope.locator("article").count(), 2);
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await card.locator("ul").isVisible(), false);
        assert.equal(await answer.getByRole("link").count(), 4);
        assert.equal(await page.getByText("REVOKED_PREVIEW_MARKER").count(), 0);
        assert.equal(
          await page.locator('a[href*="untrusted"], img, script:not([type="module"])').count(),
          0,
        );
        await verifyLayout(page);
      },
    );
    await check(`${label}: citation opens exact metadata popover within viewport`, async () => {
      if (mobile) await trigger.tap();
      else await trigger.click();
      const popover = page.getByRole("dialog");
      await popover.waitFor();
      assert.ok((await popover.innerText()).includes("Sintetik fraqment 3."));
      assert.ok((await popover.innerText()).includes("2026-10-21 · Bölmə 3:"));
      const bounds = await popover.boundingBox();
      assert.ok(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width + 1,
      );
      assert.equal(await popover.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    });
    await check(
      `${label}: source-card jump expands exact [3], scrolls and keeps fragment focus`,
      async () => {
        const jump = page.getByRole("link", { name: az.analytics.sourceCard });
        if (mobile) await jump.tap();
        else await jump.click();
        await target.waitFor({ state: "visible" });
        await page.waitForFunction((id) => document.activeElement?.id === id, targetId);
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        assert.ok((await target.innerText()).includes("Sintetik fraqment 3."));
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(await page.getByRole("dialog").count(), 0);
        const bounds = await target.boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y < page.viewportSize()!.height);
        await verifyLayout(page);
      },
    );
    await check(`${label}: repeated same-hash jump reopens collapsed card`, async () => {
      await toggle.click();
      assert.equal(await card.locator("ul").isVisible(), false);
      const sameJump = card.getByRole("link", {
        name: az.analytics.openSource.replace("{n}", "3"),
      });
      if (mobile) await sameJump.tap();
      else await sameJump.click();
      await target.waitFor({ state: "visible" });
      await page.waitForFunction((id) => document.activeElement?.id === id, targetId);
    });
    if (!mobile)
      await check("desktop: keyboard Enter/Tab/Escape and fragment focus", async () => {
        await trigger.focus();
        await trigger.press("Enter");
        await page.waitForFunction(() =>
          document.activeElement?.textContent?.includes("Tam materialı aç"),
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page
            .getByRole("link", { name: az.analytics.sourceCard })
            .evaluate((node) => node === document.activeElement),
          true,
        );
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
        await trigger.press("Enter");
        await page.waitForFunction(() =>
          document.activeElement?.textContent?.includes("Tam materialı aç"),
        );
        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
        await page.waitForFunction((id) => document.activeElement?.id === id, targetId);
        await toggle.focus();
        await toggle.press("Space");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        await toggle.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      });
    await check(`${label}: copy preserves original Markdown and citation numbering`, async () => {
      const expected = await scope.getAttribute("data-answer");
      await answer.getByRole("button", { name: az.analytics.copy }).click();
      await page.waitForFunction(
        (text) => (window as unknown as { copiedAnswer: string }).copiedAnswer === text,
        expected,
      );
      assert.equal(await answer.getByText(az.analytics.copied, { exact: true }).count(), 1);
    });
    await page.screenshot({
      path: `.release-backup.local/final-analytics-${label}.png`,
      fullPage: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  await activePage
    ?.screenshot({ path: ".release-backup.local/final-analytics-failure.png", fullPage: true })
    .catch(() => undefined);
  console.error(`FAIL: ${currentCase}: ${failure}`);
} finally {
  await browser?.close();
  await server.close();
  const result = {
    checkedAt: new Date().toISOString(),
    kind: "isolated production-component browser smoke",
    browser: process.env["BROWSER_EXECUTABLE_PATH"]
      ? "explicit Chromium-compatible executable"
      : "Microsoft Edge (headless Chromium)",
    viewports: [
      { width: 1440, height: 1000 },
      { width: 390, height: 844, touch: true },
    ],
    fixtures:
      "synthetic open data only; no DB, authentication server, provider or external API calls",
    clipboard:
      "browser Clipboard API replaced with a local capture to assert exact Markdown payload",
    checks,
    errors,
    externalRequests,
    status: failure ? "FAIL" : "PASS",
    failureCase: failure ? currentCase : null,
    failure,
    limitations:
      "Component browser coverage only; route/HTTP/security behavior is covered separately by tests and authorized integration checks.",
    screenshots: [
      ".release-backup.local/final-analytics-desktop.png",
      ".release-backup.local/final-analytics-mobile.png",
    ],
  };
  await mkdir("docs/release", { recursive: true });
  await writeFile(
    "docs/release/FINAL_ANALYTICS_BROWSER.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
