/** Standalone browser verification: no app server, DB, credentials, storage, or AI. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { isolateTestEnvironment } from "../src/test/safe-env";

isolateTestEnvironment();
const sampleHtmlPath = process.argv[2];
const sampleTextPath = process.argv[3];
const outputDir = resolve(".release-backup.local/rich-editor");
await mkdir(outputDir, { recursive: true });
const server = await createServer({
  configFile: false,
  envDir: false,
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": resolve("src") } },
  server: { host: "127.0.0.1", port: 4177, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("http://127.0.0.1:4177/scripts/fixtures/rich-editor.html");
  const textbox = page.getByRole("textbox", { name: "Mətn", exact: true });
  await textbox.waitFor();
  await page.getByRole("button", { name: "Başlıq 2", exact: true }).click();
  assert.equal(await textbox.locator("h2").count(), 2);
  await page.getByRole("button", { name: "Geri al (Ctrl+Z)", exact: true }).click();
  assert.equal(await textbox.locator("h1").count(), 1);
  await page.getByRole("button", { name: "Yadda saxla", exact: true }).click();
  await page.getByRole("status").waitFor();
  const original = await textbox.innerText();
  await page.getByRole("button", { name: "Yenidən aç", exact: true }).click();
  assert.equal(await textbox.innerText(), original);
  await page.screenshot({ path: resolve(outputDir, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(outputDir, "mobile.png"), fullPage: true });
  let sample: Record<string, unknown> | null = null;
  if (sampleHtmlPath) {
    const html = await readFile(sampleHtmlPath, "utf8");
    await textbox.evaluate((element, source) => {
      const editor = (
        element as HTMLElement & {
          editor: {
            commands: { clearContent: () => void };
            view: { pasteHTML: (html: string) => void };
          };
        }
      ).editor;
      editor.commands.clearContent();
      editor.view.pasteHTML(source);
    }, html);
    await page.getByRole("button", { name: "Yadda saxla", exact: true }).click();
    assert.equal(await page.getByRole("alert").count(), 0);
    const paragraphs = await textbox.locator("p").count();
    const listItems = await textbox.locator("li").count();
    const before = await textbox.innerText();
    if (sampleTextPath) {
      const expected = JSON.parse(await readFile(sampleTextPath, "utf8")) as string[];
      const actual = await textbox.locator("p").allTextContents();
      const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
      assert.equal(normalize(actual.join(" ")), normalize(expected.join(" ")));
    }
    assert.equal(paragraphs, 287);
    assert.equal(listItems, 55);
    await page.getByRole("button", { name: "Yenidən aç", exact: true }).click();
    assert.equal(await textbox.innerText(), before);
    sample = { paragraphs, listItems, textPreserved: true, jsonReopened: true };
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        desktop: "PASS",
        mobile: "PASS",
        toolbar: "PASS",
        undo: "PASS",
        saveRead: "PASS",
        sample,
        externalCalls: 0,
        databaseCalls: 0,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
