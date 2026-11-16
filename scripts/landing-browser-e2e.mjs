/**
 * E2E: real compiled Next homepage, actual Chromium interactions and screenshots.
 * Run only after pnpm build; no credentials, API writes or external navigation.
 * The screenshot carousel shows static dashboard captures bundled with the app.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(process.env.REVIEW_ROUTER_LANDING_E2E_PORT || 3397);
const origin = "http://127.0.0.1:" + port;
const outputDir = join(process.cwd(), "tmp", "landing-browser-e2e");
const results = [];
const log = [];
const devPreview = process.env.REVIEW_ROUTER_LANDING_E2E_DEV === "1";
const server = spawn(
  "pnpm",
  [
    "--filter",
    "@reviewrouter/web",
    "exec",
    "next",
    ...(devPreview ? ["dev", "--webpack"] : ["start"]),
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
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
    if (server.exitCode !== null)
      throw new Error("Next server exited: " + server.exitCode);
    ready = await globalThis
      .fetch(origin, {
        signal: globalThis.AbortSignal.timeout(
          Math.max(1, Math.min(5_000, deadline - Date.now())),
        ),
      })
      .then(
        (r) => r.ok,
        () => false,
      );
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, "Next production app did not start in time");
  const localBrowser =
    process.env.REVIEW_ROUTER_E2E_BROWSER_PATH ||
    ["/usr/bin/chromium", "/usr/bin/google-chrome"].find((path) =>
      existsSync(path),
    );
  browser = await chromium.launch({
    headless: true,
    ...(localBrowser ? { executablePath: localBrowser } : {}),
  });
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
          window.localStorage.setItem("reviewrouter-theme", preference);
        }, theme);
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        const response = await page.goto(origin, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        assert.equal(response?.status(), 200, "Homepage HTTP response");
        await page
          .locator(".rr-home-video__frame")
          .waitFor({ state: "visible", timeout: 45_000 });
        assert.equal(
          await page.locator("main h1").count(),
          1,
          "Exactly one main heading",
        );
        assert.match(
          await page.locator("main h1").innerText(),
          /Full control and security\./,
        );
        assert.equal(await page.locator(".rr-home-providers li").count(), 6);
        assert.equal(await page.locator(".rr-home-carousel__slide").count(), 5);
        const activeScreenshot = page.locator(
          '.rr-home-carousel__slide[data-active="true"] .rr-home-carousel__frame',
        );
        const viewer = page.getByRole("dialog");
        await activeScreenshot.scrollIntoViewIfNeeded();
        // The page is captured at domcontentloaded, so a click can land before
        // React hydrates; retry until the viewer opens.
        let viewerOpened = false;
        for (let attempt = 0; attempt < 15 && !viewerOpened; attempt += 1) {
          await activeScreenshot.click();
          viewerOpened = await viewer
            .waitFor({ state: "visible", timeout: 2_000 })
            .then(() => true)
            .catch(() => false);
        }
        assert.ok(viewerOpened, "Screenshot viewer opens on click");
        await page.keyboard.press("Escape");
        await viewer.waitFor({ state: "detached", timeout: 10_000 });
        assert.equal(await page.locator(".rr-home-hosting__card").count(), 2);
        assert.ok(
          (await page.locator(".rr-home-hero__install").innerText()).trim()
            .length > 5,
        );
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        const measurements = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          stylesheet: window.getComputedStyle(
            document.querySelector(".rr-home-video__frame"),
          ).borderTopWidth,
        }));
        assert.ok(
          measurements.documentWidth <= width + 1,
          "Horizontal overflow at " +
            width +
            "px / " +
            theme +
            ": " +
            JSON.stringify(measurements),
        );
        assert.equal(
          measurements.stylesheet,
          "1px",
          "The landing stylesheet must load",
        );
        assert.deepEqual(errors, [], "No browser runtime errors");
        await page.screenshot({
          path: join(outputDir, "landing-" + theme + "-" + width + ".png"),
          fullPage: true,
          animations: "disabled",
        });
        results.push({
          theme,
          width,
          status: "PASS",
          ...measurements,
          browserErrors: errors,
        });
        process.stdout.write("PASS landing " + theme + " " + width + "px\n");
      } finally {
        await context.close();
      }
    }
  }
  // One run with real motion: the benchmark must arm, play and settle on the
  // final values, and the carousel must keep working without reduced motion.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "no-preference",
      colorScheme: "dark",
      locale: "en-US",
    });
    try {
      const errors = [];
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page
        .locator(".rr-home-benchmark")
        .scrollIntoViewIfNeeded({ timeout: 45_000 });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".rr-home-benchmark")
            ?.getAttribute("data-phase") === "playing",
        null,
        { timeout: 15_000 },
      );
      await page.waitForFunction(
        () =>
          [
            ...document.querySelectorAll(
              '.rr-home-benchmark [aria-hidden="true"]',
            ),
          ].some((node) => node.textContent === "9.5×"),
        null,
        { timeout: 15_000 },
      );
      await page.locator(".rr-home-carousel").scrollIntoViewIfNeeded();
      await page
        .getByRole("button", { name: "Next screenshot" })
        .first()
        .click();
      assert.deepEqual(errors, [], "No runtime errors with motion enabled");
      process.stdout.write("PASS landing animated benchmark and carousel\n");
    } finally {
      await context.close();
    }
  }
  await writeFile(
    join(outputDir, "manifest.json"),
    JSON.stringify({ status: "PASS", results }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(outputDir, "manifest.json"),
    JSON.stringify(
      {
        status: "FAIL",
        results,
        failure: String(error),
        serverLog: log.slice(-45),
      },
      null,
      2,
    ),
  ).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
