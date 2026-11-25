/**
 * Captures the scenario table with Chromium: one fresh browser context per
 * screenshot (user, width, theme), all non-app requests blocked, and generic
 * page health recorded next to each image. It asserts nothing about the new
 * provider UI; `suspect` only marks shots a reviewer must not trust (error
 * page, redirect, wrong theme, runtime errors).
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright-core";
import type { VisualRunFlags, VisualUserKey } from "./fixture-contract.js";
import {
  PAGE_WIDTHS,
  VISUAL_THEMES,
  type ScenarioContext,
  type VisualScenario,
  type VisualTheme,
} from "./scenarios.js";

export type ShotStatus = "captured" | "suspect" | "failed" | "skipped";

export type ShotRecord = Readonly<{
  scenario: string;
  title: string;
  status: ShotStatus;
  user?: VisualUserKey;
  width?: number;
  theme?: VisualTheme;
  file?: string;
  reason?: string;
  httpStatus?: number | null;
  path?: string;
  heading?: string | null;
  problems?: readonly string[];
  pageErrors?: readonly string[];
  consoleErrors?: readonly string[];
  blockedRequests?: readonly string[];
  probe?: unknown;
}>;

export type CaptureInput = Readonly<{
  appUrl: string;
  outDir: string;
  flags: VisualRunFlags;
  scenarios: readonly VisualScenario[];
  sessionCookies: Readonly<Record<VisualUserKey, string>>;
  browserExecutable?: string;
  /** Restores the data set, so no shot sees another one's changes. */
  beforeShot?: () => Promise<void>;
}>;

const READY_SELECTOR = '#dashboard-section-content:not([aria-busy="true"])';
const ERROR_TEXT =
  /Application error|This page could not be found|Internal Server Error|Unhandled Runtime Error|Something went wrong/i;
const PAGE_HEIGHTS: Readonly<Record<number, number>> = {
  390: 844,
  900: 1000,
  1440: 900,
};

export async function captureScenarios(
  input: CaptureInput,
): Promise<readonly ShotRecord[]> {
  const screensDir = join(input.outDir, "screens");
  await mkdir(screensDir, { recursive: true, mode: 0o700 });
  const browser = await launchVisualBrowser(input.browserExecutable);
  const records: ShotRecord[] = [];
  try {
    for (const scenario of input.scenarios) {
      const skip = skipReason(scenario, input.flags);
      if (skip) {
        records.push({
          scenario: scenario.id,
          title: scenario.title,
          status: skip.status,
          reason: skip.reason,
        });
        continue;
      }
      for (const user of scenario.users)
        for (const width of scenario.widths ?? PAGE_WIDTHS)
          for (const theme of VISUAL_THEMES) {
            await input.beforeShot?.();
            const record = await captureShot(browser, input, {
              scenario,
              user,
              width,
              theme,
              file: join(
                "screens",
                `${scenario.id}--${user}--${width}--${theme}.png`,
              ),
            });
            records.push(record);
            process.stdout.write(
              `${record.status.padEnd(8)} ${record.file}${record.problems?.length ? ` (${record.problems.join("; ")})` : ""}\n`,
            );
          }
    }
  } finally {
    await browser.close();
  }
  return records;
}

export function launchVisualBrowser(
  executablePath: string | undefined,
): Promise<Browser> {
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
}

function skipReason(
  scenario: VisualScenario,
  flags: VisualRunFlags,
): { readonly status: ShotStatus; readonly reason: string } | null {
  for (const [flag, value] of Object.entries(scenario.requires ?? {}))
    if (flags[flag as keyof VisualRunFlags] !== value)
      return {
        status: "skipped",
        reason: `needs ${flag}=${String(value)} (run with${value ? "" : "out"} --${flag})`,
      };
  return null;
}

/** A signed-in browser page of one fixture user, with the network boundary. */
export type UserPage = Readonly<{
  context: BrowserContext;
  page: Page;
  pageErrors: string[];
  consoleErrors: string[];
  blockedRequests: string[];
}>;

export async function openUserPage(
  browser: Browser,
  input: Pick<CaptureInput, "appUrl" | "sessionCookies">,
  view: Readonly<{ user: VisualUserKey; width: number; theme: VisualTheme }>,
): Promise<UserPage> {
  const { user, width, theme } = view;
  const appOrigin = new URL(input.appUrl).origin;
  const context = await browser.newContext({
    baseURL: input.appUrl,
    viewport: { width, height: PAGE_HEIGHTS[width] ?? 900 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const blockedRequests: string[] = [];
  try {
    const [name, ...value] = input.sessionCookies[user].split("=");
    await context.addCookies([
      {
        name: name!,
        value: value.join("="),
        url: input.appUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    // The theme toggle's own storage, read before the first paint.
    await context.addInitScript((preference) => {
      localStorage.setItem("reviewrouter-theme", preference);
    }, theme);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === appOrigin || url.protocol === "data:")
        return route.continue();
      blockedRequests.push(`${route.request().method()} ${url.origin}`);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    return { context, page, pageErrors, consoleErrors, blockedRequests };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Opens a route and waits until the dashboard section rendered. */
export async function gotoDashboard(
  page: Page,
  route: string,
): Promise<Response | null> {
  const response = await page.goto(route, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  await page.waitForSelector(READY_SELECTOR, { timeout: 120_000 });
  // Server-rendered controls ignore clicks until the client bundle hydrated.
  await page
    .waitForLoadState("networkidle", { timeout: 30_000 })
    .catch(() => undefined);
  return response;
}

async function captureShot(
  browser: Browser,
  input: CaptureInput,
  shot: Readonly<{
    scenario: VisualScenario;
    user: VisualUserKey;
    width: number;
    theme: VisualTheme;
    file: string;
  }>,
): Promise<ShotRecord> {
  const { scenario, user, width, theme, file } = shot;
  const appOrigin = new URL(input.appUrl).origin;
  const { context, page, pageErrors, consoleErrors, blockedRequests } =
    await openUserPage(browser, input, { user, width, theme });
  const problems: string[] = [];
  try {
    let response: Response | null = null;
    try {
      response = await gotoDashboard(page, scenario.route);
      const scenarioContext: ScenarioContext = {
        page,
        flags: input.flags,
        user,
        width,
        theme,
      };
      await scenario.prepare?.(scenarioContext);
      // The last click leaves the pointer over whatever opened there; a
      // hover style is not part of the state under review.
      await page.mouse.move(0, 0);
      await settle(page);
      const probe = scenario.probe
        ? await scenario.probe(scenarioContext)
        : undefined;
      const health = await inspectPage(page, theme);
      problems.push(...health.problems);
      if (response && response.status() >= 400)
        problems.push(`http ${response.status()}`);
      if (
        new URL(page.url()).pathname !==
        new URL(scenario.route, appOrigin).pathname
      )
        problems.push(`redirected to ${new URL(page.url()).pathname}`);
      if (pageErrors.length) problems.push(`${pageErrors.length} page errors`);
      await hideDevOverlay(page);
      await page.screenshot({
        path: join(input.outDir, file),
        fullPage: scenario.fullPage ?? true,
        animations: "disabled",
        caret: "hide",
      });
      return {
        scenario: scenario.id,
        title: scenario.title,
        status: problems.length ? "suspect" : "captured",
        user,
        width,
        theme,
        file,
        httpStatus: response?.status() ?? null,
        path: new URL(page.url()).pathname + new URL(page.url()).search,
        heading: health.heading,
        problems,
        pageErrors,
        consoleErrors,
        blockedRequests,
        ...(probe === undefined ? {} : { probe }),
      };
    } catch (error) {
      // Keep whatever rendered as evidence of the failure.
      await page
        .screenshot({ path: join(input.outDir, file), fullPage: true })
        .catch(() => undefined);
      return {
        scenario: scenario.id,
        title: scenario.title,
        status: "failed",
        user,
        width,
        theme,
        file,
        reason:
          error instanceof Error
            ? (error.message.split("\n")[0] ?? error.message)
            : String(error),
        httpStatus: response?.status() ?? null,
        pageErrors,
        consoleErrors,
        blockedRequests,
      };
    }
  } finally {
    await context.close();
  }
}

/** Fonts loaded, client requests quiet, layout stable. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

async function inspectPage(
  page: Page,
  theme: VisualTheme,
): Promise<{ readonly heading: string | null; readonly problems: string[] }> {
  const facts = await page.evaluate(() => {
    // Visible text of the Next dev overlay, without its inline styles.
    const portal = document.querySelector("nextjs-portal")?.shadowRoot;
    let overlayText = "";
    if (portal) {
      const walker = document.createTreeWalker(portal, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (!node.parentElement?.closest("style, script"))
          overlayText += ` ${node.textContent ?? ""}`;
    }
    return {
      theme: document.documentElement.dataset.theme ?? null,
      heading:
        document
          .querySelector("#dashboard-section-content h2, main h1, main h2")
          ?.textContent?.trim() ?? null,
      bodyText: document.body.innerText.slice(0, 20_000),
      overlayText: overlayText.slice(0, 300),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  const problems: string[] = [];
  if (facts.theme !== theme) problems.push(`theme ${facts.theme ?? "unset"}`);
  if (ERROR_TEXT.test(facts.bodyText)) problems.push("error text on page");
  // The dev badge always renders an issue counter; only a count above zero
  // or an error dialog is a problem.
  const issueCount = /(\d+)\s*Issues?\b/i.exec(facts.overlayText)?.[1];
  if (
    Number(issueCount ?? 0) > 0 ||
    /Runtime Error|Build Error|Unhandled/i.test(facts.overlayText)
  )
    problems.push(`dev overlay: ${facts.overlayText.trim().slice(0, 120)}`);
  if (facts.scrollWidth > facts.clientWidth + 1)
    problems.push(
      `horizontal overflow ${facts.scrollWidth}>${facts.clientWidth}`,
    );
  return { heading: facts.heading, problems };
}

/** The Next dev indicator is not part of the product. */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}
