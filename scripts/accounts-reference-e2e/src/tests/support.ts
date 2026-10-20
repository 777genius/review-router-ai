import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

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

export async function openAccounts(
  page: Page,
  workspace: string,
): Promise<void> {
  // This inventory GET starts after its streamed client subtree hydrates.
  const personalHydrated = workspace.startsWith("rr-e2e-personal-")
    ? page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/dashboard/accounts/access" &&
          url.searchParams.get("view") === "summaries" &&
          response.request().method() === "GET"
        );
      })
    : null;
  await page.goto(
    `/dashboard/setup?workspace=${encodeURIComponent(workspace)}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  // The "Accounts" page heading was removed (UX batch 3); the section region
  // is the page's top anchor and marks the content as rendered.
  await expect(
    page.getByRole("region", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
  if (personalHydrated) await personalHydrated;
}

export function sourceRow(page: Page, label: string, scope?: Locator): Locator {
  return (scope ?? page).getByRole("article", { name: label, exact: true });
}

export function organizationAccountsRegion(page: Page): Locator {
  return page.getByRole("region", {
    name: "Available connections",
  });
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
