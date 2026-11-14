/**
 * E2E: real compiled Next homepage, actual Chromium interactions and screenshots.
 * Run only after pnpm build; no credentials, API writes or external navigation.
 * Screens are illustrative product content, not screenshots of real customer runs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(process.env.REVIEW_ROUTER_LANDING_E2E_PORT || 3397);
const origin = "http://127.0.0.1:" + port;
const outputDir = join(process.cwd(), "tmp", "landing-browser-e2e");
const results = [];
const log = [];
const server = spawn(
  "pnpm",
  ["--filter", "@reviewrouter/web", "exec", "next", "start", "-H", "127.0.0.1", "-p", String(port)],
  { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] },
);
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    log.push(String(chunk));
    if (log.length > 300) log.shift();
  });
}

let browser;
try {
  await mkdir(outputDir, { recursive: true });
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Next server exited: " + server.exitCode);
    ready = await fetch(origin).then((r) => r.ok, () => false);
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, "Next production app did not start in time");
  browser = await chromium.launch({ headless: true });
  for (const theme of ["dark", "light"]) {
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        colorScheme: theme,
        locale: "en-US",
      });
      const errors = [];
      try {
        await context.addInitScript((preference) => {
          localStorage.setItem("reviewrouter-theme", preference);
        }, theme);
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        const response = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
        assert.equal(response?.status(), 200, "Homepage HTTP response");
        await page.locator(".rr-home-window").waitFor({ state: "visible", timeout: 45_000 });
        assert.equal(await page.locator("main h1").count(), 1, "Exactly one main heading");
        assert.match(await page.locator("main h1").innerText(), /Your model\. Your budget\./);
        assert.equal(await page.locator(".rr-home-finding").count(), 3);
        assert.equal(await page.locator(".rr-home-hosting__card").count(), 2);
        assert.ok((await page.locator(".rr-home-hero__install").innerText()).trim().length > 5);
        assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        const logoLoaded = await page.locator(".rr-home-window__identity img").evaluate(
          (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
        );
        assert.ok(logoLoaded, "The actual ReviewRouter logo must load");
        const select = async (tab, needle) => {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await page.getByRole("button", { name: tab, exact: true }).click();
            try {
              await page.getByText(needle, { exact: true }).waitFor({ state: "visible", timeout: 2500 });
              return;
            } catch (error) {
              if (attempt === 3) throw error;
              await delay(250);
            }
          }
        };
        await select("Commits", "Add regression tests");
        await select("Insights", "Known costs");
        await select("Findings", "Missing input validation");
        const measurements = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          animation: getComputedStyle(document.querySelector(".rr-home-finding")).animationName,
          stylesheet: getComputedStyle(document.querySelector(".rr-home-window")).borderTopWidth,
        }));
        assert.ok(
          measurements.documentWidth <= width + 1,
          "Horizontal overflow at " + width + "px / " + theme + ": " + JSON.stringify(measurements),
        );
        assert.equal(measurements.animation, "none", "Reduced motion must suppress finding animations");
        assert.equal(measurements.stylesheet, "1px", "The landing stylesheet must load");
        assert.deepEqual(errors, [], "No browser runtime errors");
        await page.screenshot({
          path: join(outputDir, "landing-" + theme + "-" + width + ".png"),
          fullPage: true,
          animations: "disabled",
        });
        results.push({ theme, width, status: "PASS", ...measurements, browserErrors: errors });
        process.stdout.write("PASS landing " + theme + " " + width + "px\n");
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(join(outputDir, "manifest.json"), JSON.stringify({ status: "PASS", results }, null, 2));
} catch (error) {
  await writeFile(
    join(outputDir, "manifest.json"),
    JSON.stringify({ status: "FAIL", results, failure: String(error), serverLog: log.slice(-45) }, null, 2),
  ).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
