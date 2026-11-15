import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const dir = "tmp/landing-visual-qa";
const port = 3188;
const url = `http://127.0.0.1:${port}`;
const logs = [];
const samples = [];
const errors = [];
await mkdir(dir, { recursive: true });

// Run the already-built Next.js application. Development-mode browser timings
// are not representative of the shipped page.
const server = spawn(
  "pnpm",
  ["--filter", "@reviewrouter/web", "exec", "next", "start", "--hostname", "127.0.0.1", "-p", String(port)],
  { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.on("data", (chunk) => logs.push(String(chunk)));
server.stderr.on("data", (chunk) => logs.push(String(chunk)));
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw Error(`Production Next.js exited: ${server.exitCode}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) {
        ready = true;
        break;
      }
    } catch { /* Still booting. */ }
    await delay(400);
  }
  if (!ready) throw Error(`Production Next.js startup timeout:\n${logs.join("").slice(-4000)}`);

  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  for (const theme of ["light", "dark"]) {
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        deviceScaleFactor: 1,
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      try {
        await context.addInitScript((selectedTheme) => {
          try { localStorage.setItem("reviewrouter-theme", selectedTheme); } catch { /* Blocked storage. */ }
          window.__landingVitals = { lcp: 0, cls: 0, longTaskMs: 0 };
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) window.__landingVitals.lcp = entry.startTime;
            }).observe({ type: "largest-contentful-paint", buffered: true });
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__landingVitals.cls += entry.value;
              }
            }).observe({ type: "layout-shift", buffered: true });
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) window.__landingVitals.longTaskMs += entry.duration;
            }).observe({ type: "longtask", buffered: true });
          } catch { /* Optional browser observers. */ }
        }, theme);
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
        if (!response?.ok()) throw Error(`Production homepage HTTP ${response?.status()}`);
        await page.locator('[aria-label="Illustrative AI review preview"][data-interactive-ready="true"]').waitFor({ timeout: 30000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1000);
        const result = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          const paint = performance.getEntriesByType("paint");
          const resources = performance.getEntriesByType("resource");
          const v = window.__landingVitals;
          return {
            resolvedTheme: document.documentElement.getAttribute("data-theme"),
            ttfbMs: navigation?.responseStart - navigation?.requestStart,
            domContentLoadedMs: navigation?.domContentLoadedEventEnd,
            loadMs: navigation?.loadEventEnd,
            fcpMs: paint.find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null,
            lcpMs: v?.lcp || null,
            cls: v?.cls ?? null,
            longTaskMs: v?.longTaskMs ?? null,
            resourceCount: resources.length,
            resourceTransferKiB: Math.round(resources.reduce((total, entry) => total + entry.transferSize, 0) / 1024),
            horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2,
          };
        });
        if (result.resolvedTheme !== theme) throw Error(`Production theme mismatch: expected ${theme}, got ${result.resolvedTheme}`);
        if (pageErrors.length) throw Error(`Production browser JavaScript errors: ${pageErrors.join(" | ")}`);
        samples.push({ theme, width, ...result });
        console.log(`PRODUCTION_PERFORMANCE ${theme}/${width} ${JSON.stringify(result)}`);
        if (!Number.isFinite(result.ttfbMs) || result.ttfbMs < 0 ||
            !Number.isFinite(result.fcpMs) || result.fcpMs <= 0 ||
            !Number.isFinite(result.lcpMs) || result.lcpMs <= 0 ||
            !Number.isFinite(result.cls) || result.horizontalOverflow) {
          throw Error(`Incomplete/invalid production performance metrics: ${JSON.stringify(result)}`);
        }
      } catch (error) {
        errors.push(`${theme}/${width}: ${String(error)}`);
      } finally {
        await context.close();
      }
    }
  }
  if (samples.length !== 6 || errors.length) throw Error(`Production performance QA failed: ${errors.join("; ")}`);
} catch (error) {
  errors.push(String(error));
  console.error(`Production Next.js output (tail):\n${logs.join("").slice(-4000)}`);
  throw error;
} finally {
  await writeFile(`${dir}/performance.json`, JSON.stringify({
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    note: "Single-run local Chromium navigation timings on production Next.js; not Lighthouse or field Web Vitals.",
    samples,
    errors,
  }, null, 2));
  await writeFile(`${dir}/production-next.log`, logs.join("").slice(-12000));
  await browser?.close();
  server.kill("SIGTERM");
}
