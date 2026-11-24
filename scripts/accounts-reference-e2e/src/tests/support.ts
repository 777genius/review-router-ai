import type {
  BrowserContext,
  Locator,
  Page,
  Request,
  Response,
} from "@playwright/test";
import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { warmAccountsRoutes } from "../warm-accounts-routes.ts";

const observedRequests = new WeakMap<
  Page,
  { method: string; origin: string; path: string; allowed: boolean }[]
>();
export const browserRequestsFor = (page: Page) =>
  observedRequests.get(page) ?? [];

export const VIEWER_COOKIE =
  process.env.ACCOUNTS_REFERENCE_E2E_VIEWER_COOKIE ?? "";
export const OTHER_COOKIE =
  process.env.ACCOUNTS_REFERENCE_E2E_OTHER_COOKIE ?? "";

export async function installLoopbackOnlyNetworkGuard(
  page: Page,
  violations: string[],
): Promise<void> {
  const requests: {
    method: string;
    origin: string;
    path: string;
    allowed: boolean;
  }[] = [];
  observedRequests.set(page, requests);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      url.hostname,
    );
    if (!loopback) {
      violations.push(route.request().url());
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      origin: url.origin,
      path: url.pathname,
      allowed: ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
        url.hostname,
      ),
    });
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
      violations.push(request.url());
    }
  });
}

export async function useViewerSession(context: BrowserContext): Promise<void> {
  if (!VIEWER_COOKIE)
    throw new Error("accounts_reference_e2e_viewer_cookie_missing");
  const [name, value] = splitCookie(VIEWER_COOKIE);
  await context.addCookies([
    {
      name,
      value,
      url: process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL ?? "http://127.0.0.1",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function useOtherSession(context: BrowserContext): Promise<void> {
  if (!OTHER_COOKIE)
    throw new Error("accounts_reference_e2e_other_cookie_missing");
  const [name, value] = splitCookie(OTHER_COOKIE);
  await context.addCookies([
    {
      name,
      value,
      url: process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL ?? "http://127.0.0.1",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

function splitCookie(cookie: string): [string, string] {
  const separator = cookie.indexOf("=");
  if (separator < 1)
    throw new Error("accounts_reference_e2e_cookie_shape_invalid");
  return [cookie.slice(0, separator), cookie.slice(separator + 1)];
}

export function openAccounts(page: Page, workspace: string): Promise<void> {
  return navigateAccounts(page, workspace, () =>
    page.goto(`/dashboard/setup?workspace=${encodeURIComponent(workspace)}`, {
      waitUntil: "domcontentloaded",
    }),
  );
}

export function reloadAccounts(page: Page): Promise<void> {
  const workspace = new URL(page.url()).searchParams.get("workspace") ?? "";
  return navigateAccounts(page, workspace, () =>
    page.reload({ waitUntil: "domcontentloaded" }),
  );
}

async function navigateAccounts(
  page: Page,
  workspace: string,
  navigate: () => Promise<unknown>,
): Promise<void> {
  // Next dev may evict boot-warmed routes between scenarios. Prepare only the
  // subscription fixture before navigation; the real inventory keeps its own
  // unchanged readiness deadline below.
  if (process.env.ACCOUNTS_REFERENCE_E2E_SUBSCRIPTIONS === "1")
    await warmAccountsRoutes(process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL);
  // Capture fast replies during navigation, but start the readiness deadline
  // only after the new page is rendered. Navigation has its own bounded wait.
  let personalHydrated = !workspace.startsWith("rr-e2e-personal-");
  const observeInventory = (response: Response) => {
    const url = new URL(response.url());
    if (
      url.pathname === "/api/dashboard/accounts/access" &&
      url.searchParams.get("view") === "summaries" &&
      response.request().method() === "GET"
    )
      personalHydrated = true;
  };
  if (!personalHydrated) page.on("response", observeInventory);
  try {
    await navigate();
    // The Connections section region is the page's top anchor and marks the
    // current account-management content as rendered.
    await expect(
      page.getByRole("region", { name: "Connections", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-dashboard-layout-ready",
      "true",
    );
    await expect.poll(() => personalHydrated).toBe(true);
  } finally {
    page.off("response", observeInventory);
  }
}

export function sourceRow(page: Page, label: string, scope?: Locator): Locator {
  return (scope ?? page).getByRole("article", { name: label, exact: true });
}

/** The one Connections list: the viewer's own rows, then the workspace's. */
export function connectionsListRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Connections", exact: true });
}

export async function expectNetworkViolations(
  violations: readonly string[],
): Promise<void> {
  expect(
    violations,
    "The harness must not call GitHub, GitLab, provider APIs, or any external network",
  ).toEqual([]);
}

export function dialogFor(page: Page): Locator {
  return page.getByRole("dialog");
}

export async function activeElementInside(locator: Locator): Promise<boolean> {
  return await locator.evaluate((element) => {
    const active = document.activeElement;
    return Boolean(active && element.contains(active));
  });
}

export async function bodyScrollLocked(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const body = getComputedStyle(document.body).overflow;
    const root = getComputedStyle(document.documentElement).overflow;
    return body.includes("hidden") || root.includes("hidden");
  });
}

/** No secret stays in storage, the URL, markup or form fields. */
export async function noSecrets(page: Page, secrets: readonly string[]) {
  const retained = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      location: location.href,
      markup: document.body.innerHTML,
      inputValues: Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        ),
        (input) => input.value,
      ),
    }),
  );
  for (const secret of secrets) expect(retained).not.toContain(secret);
}

/** Watches every channel a secret could leak through until `verify`. */
export function captureSecretLeaks(page: Page, secrets: readonly string[]) {
  const leakedChannels = new Set<string>();
  const pending = new Set<Promise<void>>();
  const activePosts = new Map<Request, () => void>();
  let inspectedResponses = 0;
  const inspect = (channel: string, value: string) => {
    if (secrets.some((secret) => value.includes(secret)))
      leakedChannels.add(channel);
  };
  page.on("console", (message) => inspect("browser console", message.text()));
  page.on("pageerror", (error) => inspect("browser error", error.message));
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    // A server action may still be sending its reply after the UI is ready.
    // Register it before headers arrive so drain cannot race a reload.
    const completed = new Promise<void>((resolve) =>
      activePosts.set(request, resolve),
    );
    pending.add(completed);
    void completed.then(() => pending.delete(completed));
  });
  const finishPost = (request: Request) => {
    activePosts.get(request)?.();
    activePosts.delete(request);
  };
  page.on("requestfailed", finishPost);
  page.on("requestfinished", (request) => {
    // Next may keep speculative navigation streams open. Inspect complete
    // responses instead of waiting forever after their headers arrive.
    const reading: Promise<void> = (async () => {
      const response = await request.response();
      if (
        !response ||
        !/json|text\/html|text\/x-component/.test(
          response.headers()["content-type"] ?? "",
        )
      )
        return;
      try {
        const body = await response.text();
        inspectedResponses += 1;
        inspect("HTTP/SSR response", body);
      } catch {
        leakedChannels.add("unreadable completed HTTP/SSR response");
      }
    })().finally(() => {
      pending.delete(reading);
      finishPost(request);
    });
    pending.add(reading);
  });
  const drain = async () => {
    // Drain active actions and all completed body reads before navigation can
    // evict the previous document. Speculative GET streams need not terminate.
    while (pending.size) await Promise.all([...pending]);
  };
  return {
    drain,
    verify: async () => {
      await drain();
      expect(inspectedResponses).toBeGreaterThan(0);
      const workDir = dirname(process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON!);
      for (const name of [
        "next-app.log",
        "gateway-requests.jsonl",
        "runtime.json",
        "boot-report.json",
        "boot-viewer.html",
      ]) {
        inspect(name, await readFile(join(workDir, name), "utf8"));
      }
      // Report the channel only; never copy a secret into assertion diagnostics.
      expect([...leakedChannels]).toEqual([]);
    },
  };
}
