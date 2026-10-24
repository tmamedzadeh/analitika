/** Real Edge UI check, synthetic services and localhost only. Never contacts DB or Gemini. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright-core";
const parentId = "00000000-0000-4000-8000-000000000001";
const chunkId = "00000000-0000-4000-8000-000000000002";
const compact = process.argv.includes("--compact");
const checks: string[] = [];
const errors: string[] = [];
const service = resolve("scripts/fixtures/unified-services.ts");
const server = await createServer({
  configFile: false,
  envFile: false,
  appType: "custom",
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      ...["analytics", "auth", "briefs", "documents"].map((name) => ({
        find: `@/lib/${name}.functions`,
        replacement: service,
      })),
      { find: "@", replacement: resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
server.middlewares.use(async (request, response, next) => {
  if (!request.headers.accept?.includes("text/html")) return next();
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    await server.transformIndexHtml(
      request.url ?? "/",
      '<!doctype html><html lang="az"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/unified-ui.tsx"></script></body></html>',
    ),
  );
});
await mkdir(".release-backup.local/unified-ui", { recursive: true });
await server.listen();
const address = server.httpServer!.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  for (const width of compact ? [1440, 390] : [1440, 820, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of compact
      ? ["/", "/senedler", "/axtaris"]
      : [
          "/",
          "/senedler",
          "/axtaris",
          "/brifler/yeni",
          "/senedler/yeni",
          `/senedler/${parentId}?chunk=${chunkId}`,
          `/brifler/${parentId}?chunk=${chunkId}`,
          `/brifler/${parentId}/redakte`,
        ]) {
      await page.goto(origin + path);
      await page.locator("h1").waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      if (["/", "/senedler", "/axtaris"].includes(path)) {
        const period = page.getByRole("combobox", { name: "Dövr" });
        assert.equal(await period.inputValue(), "30d");
        assert.equal(await period.locator('option[value="all"]').count(), 0);
        await period.selectOption("custom");
        const calendar = page.getByRole("dialog");
        await calendar.waitFor();
        assert.equal(await page.getByRole("button", { name: "Tətbiq et" }).isDisabled(), true);
        const box = await calendar.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
        await page.getByRole("button", { name: "Ləğv et" }).click();
        assert.equal(await period.inputValue(), "30d");
        await period.selectOption("90d");
        if (path !== "/axtaris") {
          await page.waitForFunction(
            () =>
              (
                window as unknown as { unified: { calls: { data: { period: string } }[] } }
              ).unified.calls.at(-1)?.data.period === "90d",
          );
          await page.reload();
          await page.getByRole("combobox", { name: "Dövr" }).waitFor();
          assert.equal(await page.getByRole("combobox", { name: "Dövr" }).inputValue(), "90d");
        } else
          assert.equal(
            await page.getByRole("checkbox", { name: "Bülletenlərdə də axtar" }).isChecked(),
            true,
          );
      }
      if (path === "/senedler" || path === "/axtaris") {
        await page.getByRole("button", { name: "Mənbə etibarlılığı: Hamısı" }).click();
        await page.getByRole("checkbox", { name: /^A ·/ }).check();
        await page.getByRole("checkbox", { name: /^C ·/ }).check();
        assert.equal(await page.getByRole("checkbox", { name: /^F ·/ }).count(), 0);
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Mənbə etibarlılığı: A, C" }).waitFor();
        await page.reload();
        await page.getByRole("button", { name: "Mənbə etibarlılığı: A, C" }).waitFor();
      }
      if (path === "/brifler/yeni")
        assert.equal(await page.locator('input[name="classification"]').count(), 0);
      if (path === "/") assert.equal(await page.locator(".line-clamp-4").count(), 6);
      if (path.includes("?chunk=")) {
        await page.locator(".chunk-highlight").first().waitFor();
        assert.equal(
          await page
            .locator(".chunk-highlight")
            .first()
            .evaluate((node) => getComputedStyle(node).animationName),
          "none",
        );
      }
      if (path === "/senedler/yeni") {
        assert.equal(await page.locator('input[name="sourceReliability"]:checked').count(), 0);
        assert.equal(await page.locator('input[name="infoCredibility"]:checked').count(), 0);
        assert.equal(await page.locator('input[name="sourceReliability"][value="F"]').count(), 0);
        assert.equal(await page.locator('input[name="infoCredibility"][value="6"]').count(), 0);
      }
      await page.screenshot({
        path: `.release-backup.local/unified-ui/${width}-${path.replaceAll("/", "_").replaceAll("?", "_").replaceAll("=", "_") || "briefs"}.png`,
        fullPage: true,
      });
      checks.push(
        `${width}px ${path}: no overflow, visible production UI and shared filter behavior`,
      );
      if (path === "/axtaris") {
        await page.getByRole("button", { name: /Tarixçədə saxlanılmış sorğu/ }).click();
        await page.getByText(/Əvvəlki filtrlər yalnız oxuma rejimindədir/).waitFor();
        assert.equal(await page.getByRole("combobox", { name: "Dövr" }).inputValue(), "legacy");
        assert.equal(
          await page.getByRole("checkbox", { name: "Bülletenlərdə də axtar" }).isChecked(),
          false,
        );
        await page.screenshot({
          path: `.release-backup.local/unified-ui/${width}-history.png`,
          fullPage: true,
        });
        checks.push(`${width}px history: legacy period and OFF remain visible`);
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
  await writeFile(
    ".release-backup.local/unified-ui/results.json",
    JSON.stringify({ status: "PASS", checks, errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
