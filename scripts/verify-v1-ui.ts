/** Synthetic browser harness: no configured DB, S3, Inngest or AI is imported/called. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import sharp from "sharp";

const root = process.cwd();
const directory = resolve(root, ".gate-backup/v1-ui");
await mkdir(directory, { recursive: true });
await mkdir("docs/release", { recursive: true });
const original = await sharp(randomBytes(1500 * 1200 * 3), {
  raw: { width: 1500, height: 1200, channels: 3 },
})
  .png()
  .toBuffer();
const display = await sharp(original).resize(1000).webp({ quality: 80 }).toBuffer();
const checks: string[] = [];
const metrics = {
  largestRangeResponse: 0,
  originalRangeRequests: 0,
  uploadBytes: 0,
  deniedRequests: 0,
  externalRequestsBlocked: 0,
};
const errors: string[] = [];
await writeFile(
  resolve(directory, "mock-images.ts"),
  `
let slots: any[] = [];
export function configureFile(file: File) { slots = [{id:'slot',clientFileId:'client-file',name:file.name,mime:file.type,size:file.size,generation:1,state:'pending',expiresAt:new Date(Date.now()+86400000).toISOString(),errorCode:null}]; }
export async function getDocumentImageState() { return slots.map(s=>({...s})); }
export async function prepareDocumentImage() { slots[0].generation++; slots[0].state='uploading'; return {state:'uploading',url:'/synthetic-upload',generation:slots[0].generation,expiresAt:new Date(Date.now()+300000).toISOString()}; }
export async function completeDocumentImage() { await new Promise(r=>setTimeout(r,700)); slots[0].state='ready'; return {state:'ready'}; }
export async function cancelDocumentImageUpload() { slots[0].state='cancelled'; return {state:'cancelled'}; }
`,
);
await writeFile(
  resolve(directory, "entry.tsx"),
  `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PhotoGallery} from '@/components/PhotoGallery';
import {PasswordInput} from '@/components/PasswordInput';
import {PeriodFilter} from '@/components/PeriodFilter';
import {DocumentImageUploadProvider,DocumentImageUploadStatus} from '@/components/DocumentImageUploads';
import {useDocumentImageUploads} from '@/lib/document-image-context';
import {configureFile} from './mock-images';
import '/src/styles.css';
const params=new URLSearchParams(location.search); const count=Number(params.get('count')||10); const kind=params.get('kind')||'document';
const photos=Array.from({length:count},(_,i)=>({id:'photo-'+i,name:'Synthetic '+(i+1),url:'/api/attachments/'+kind+'/parent/photo-'+i+(params.has('denied')?'?denied=1':''),originalUrl:'/api/attachments/'+kind+'/parent/photo-'+i+'?original=1'}));
function Upload(){const manager=useDocumentImageUploads();return <section className="panel p-4"><p>Mətnin indekslənməsi: Hazırdır</p><button className="pill" onClick={async()=>{const blob=await (await fetch('/synthetic-file.png')).blob();const file=new File([blob],'synthetic.png',{type:'image/png'});configureFile(file);manager?.start('synthetic-document',new Map([['client-file',file]]));}}>Start synthetic upload</button><DocumentImageUploadStatus documentId="synthetic-document" canManage /></section>}
function App(){const[period,setPeriod]=useState<any>({period:'all'});const[analytics,setAnalytics]=useState<any>({period:'30d'});return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DocumentImageUploadProvider><main className="mx-auto max-w-6xl space-y-8 bg-background p-6 text-foreground"><h1>ZIRVƏ · Synthetic UI acceptance</h1><section data-testid="catalog"><PeriodFilter variant="catalog" value={period} onChange={setPeriod}/></section><section data-testid="analytics"><PeriodFilter value={analytics} onChange={setAnalytics}/></section><section className="grid gap-4 sm:grid-cols-3">{['current','new','confirmation'].map(name=><label key={name}>{name}<PasswordInput name={name} defaultValue={'synthetic-'+name}/></label>)}</section><PhotoGallery photos={photos} title="Synthetic material"/><Upload/></main></DocumentImageUploadProvider></QueryClientProvider>}
createRoot(document.getElementById('root')!).render(<App/>);
`,
);
const server = await createServer({
  configFile: false,
  root,
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: "@/lib/document-images.functions",
        replacement: resolve(directory, "mock-images.ts"),
      },
      { find: "@", replacement: resolve(root, "src") },
    ],
  },
  plugins: [
    react(),
    tailwind(),
    {
      name: "synthetic-ui",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1:4186");
          if (url.pathname === "/") {
            void vite
              .transformIndexHtml(
                request.url ?? "/",
                '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.gate-backup/v1-ui/entry.tsx"></script></body></html>',
              )
              .then((html) => {
                response.setHeader("content-type", "text/html");
                response.end(html);
              });
            return;
          }
          if (url.pathname === "/synthetic-upload") {
            request.on("data", (bytes) => (metrics.uploadBytes += bytes.length));
            request.on("end", () => {
              response.statusCode = 204;
              response.end();
            });
            return;
          }
          if (url.pathname === "/synthetic-file.png") {
            response.setHeader("content-type", "image/png");
            response.end(original);
            return;
          }
          if (!url.pathname.startsWith("/api/attachments/")) {
            next();
            return;
          }
          response.setHeader("cache-control", "private, no-store");
          if (url.searchParams.has("denied")) {
            metrics.deniedRequests++;
            response.statusCode = 404;
            response.end();
            return;
          }
          const body = url.searchParams.has("original") ? original : display;
          response.setHeader(
            "content-type",
            url.searchParams.has("original") ? "image/png" : "image/webp",
          );
          const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
          if (range) {
            const start = Number(range[1]);
            const end = Math.min(Number(range[2]), body.length - 1);
            if (start > end || end - start + 1 > 1024 * 1024) {
              response.statusCode = 416;
              response.end();
              return;
            }
            const part = body.subarray(start, end + 1);
            metrics.largestRangeResponse = Math.max(metrics.largestRangeResponse, part.length);
            if (url.searchParams.has("original")) metrics.originalRangeRequests++;
            response.statusCode = 206;
            response.setHeader("content-range", `bytes ${start}-${end}/${body.length}`);
            response.setHeader("content-length", part.length);
            response.end(part);
          } else response.end(body);
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 4186, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  downloadsPath: resolve(directory, "downloads"),
  args: ["--no-sandbox", "--disable-gpu"],
});
async function check(name: string, test: () => Promise<void>) {
  await test();
  checks.push(name);
  console.log("PASS: " + name);
}
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      metrics.externalRequestsBlocked++;
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("http://127.0.0.1:4186/?count=10");
  await check("catalog and analytics options/defaults", async () => {
    await page.getByTestId("catalog").getByRole("combobox").waitFor();
    assert.deepEqual(await page.getByTestId("catalog").locator("select option").allTextContents(), [
      "Bütün dövr",
      "Xüsusi dövr",
    ]);
    assert.equal(await page.getByTestId("catalog").getByRole("combobox").inputValue(), "all");
    assert.equal(await page.getByTestId("analytics").getByRole("combobox").inputValue(), "30d");
    assert(
      (await page.getByTestId("analytics").locator("select option").allTextContents()).includes(
        "Hamısı",
      ),
    );
  });
  await check("password keyboard toggle preserves independent values", async () => {
    const input = page.locator('input[name="current"]');
    const toggle = input.locator("..").getByRole("button");
    await toggle.focus();
    await page.keyboard.press("Space");
    assert.equal(await input.getAttribute("type"), "text");
    assert.equal(await input.inputValue(), "synthetic-current");
    assert.equal(await page.locator('input[name="new"]').getAttribute("type"), "password");
    await page.keyboard.press("Enter");
    assert.equal(await input.getAttribute("type"), "password");
  });
  await check("10-photo gallery selected index, keyboard, zoom, focus and URL", async () => {
    const initial = page.url();
    const trigger = page.getByRole("button", { name: "Synthetic 2 · 2 / 10" });
    await trigger.click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").locator("img").waitFor();
    assert(await page.getByText("2 / 10", { exact: true }).isVisible());
    await page.keyboard.press("ArrowRight");
    assert(await page.getByText("3 / 10", { exact: true }).isVisible());
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("button", { name: "Şəkli böyüt" }).click();
    assert(
      (await page.getByRole("dialog").locator("img").getAttribute("style"))?.includes("scale(2)"),
    );
    await page.getByRole("button", { name: "Miqyası sıfırla" }).first().click();
    await page.screenshot({ path: "docs/release/ZIRVE_V1_GALLERY_DESKTOP.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(page.url(), initial);
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Synthetic 2 · 2 / 10",
      { timeout: 3000 },
    );
    assert(await trigger.evaluate((node) => node === document.activeElement));
    await trigger.click();
    await page.getByRole("dialog").locator("img").waitFor();
  });
  await check("original >4.5MB download is byte-identical through private ranges", async () => {
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Orijinalı yüklə" }).click();
    const download = await downloadEvent;
    const target = resolve(directory, "downloaded-original.png");
    await download.saveAs(target);
    assert.equal(
      createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
      createHash("sha256").update(original).digest("hex"),
    );
    assert(metrics.largestRangeResponse <= 1024 * 1024);
    assert(metrics.originalRangeRequests > 4);
    await page.keyboard.press("Escape");
  });
  await check("text remains ready while actual browser bytes upload and validate", async () => {
    await page.getByRole("button", { name: "Start synthetic upload" }).click();
    await page.getByText("Yoxlanılır", { exact: true }).waitFor();
    assert(await page.getByText("Mətnin indekslənməsi: Hazırdır", { exact: true }).isVisible());
    await page.getByText("Hazırdır", { exact: true }).last().waitFor();
    assert.equal(metrics.uploadBytes, original.length);
  });
  await page.goto("http://127.0.0.1:4186/?count=1&kind=brief&denied=1");
  await check("one-photo bulletin error/retry and close", async () => {
    await page.getByRole("button", { name: "Synthetic 1 · 1 / 1" }).click();
    await page.getByRole("dialog").getByRole("alert").waitFor();
    assert.equal(await page.getByRole("button", { name: "Növbəti şəkil" }).count(), 0);
    await page.getByRole("dialog").getByRole("button", { name: "Yenidən cəhd et" }).click();
    await page.getByRole("dialog").getByRole("alert").waitFor();
    await page.keyboard.press("Escape");
  });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto("http://127.0.0.1:4186/?count=3&kind=brief");
  await check("mobile bulletin swipe, pinch zoom and viewport fit", async () => {
    await phone.getByRole("button", { name: "Synthetic 1 · 1 / 3" }).click();
    await phone.getByRole("dialog").locator("img").waitFor();
    const session = await mobile.newCDPSession(phone);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 310, y: 380, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 100, y: 380, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await phone.getByText("2 / 3", { exact: true }).waitFor();
    await phone.getByRole("dialog").locator("img").waitFor();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 145, y: 380, id: 1 },
        { x: 245, y: 380, id: 2 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: 100, y: 380, id: 1 },
        { x: 290, y: 380, id: 2 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert(
      !(await phone.getByRole("dialog").locator("img").getAttribute("style"))?.includes("scale(1)"),
    );
    await phone.getByRole("button", { name: "Miqyası sıfırla" }).first().click();
    await phone.screenshot({ path: "docs/release/ZIRVE_V1_GALLERY_MOBILE.png" });
    const bounds = await phone.getByRole("dialog").locator("img").boundingBox();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.width <= 390 &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 844,
      JSON.stringify(bounds),
    );
    assert.equal(
      await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await phone.screenshot({ path: "docs/release/ZIRVE_V1_GALLERY_MOBILE.png" });
    await phone.getByRole("button", { name: "Qalereyanı bağla" }).click();
    await session.detach();
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "docs/release/ZIRVE_V1_UI_CHECKS.json",
    JSON.stringify(
      {
        scope:
          "Synthetic local harness using actual shared components; actual endpoint ACL tested separately",
        checks,
        metrics,
        errors,
        configuredServicesCalled: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, metrics }));
  await mobile.close();
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
