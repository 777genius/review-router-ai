import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
} from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import {
  browserRequestsFor,
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  openAccounts,
  sourceRow,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_LIMITS !== "1",
  "Requires the controlled --limits-fixture Gateway HTTP harness; no live provider proof.",
);
const gateway = process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL;
type Stats = {
  reads: number;
  completed: number;
  readAccounts: string[];
  completedAccounts: string[];
  observedAt: string;
  resetAt: string;
};
async function configure(
  request: APIRequestContext,
  mode: string,
  delayMs = 0,
) {
  const response = await request.post(`${gateway}/__limits-fixture`, {
    data: { mode, delayMs },
  });
  expect(response.ok()).toBe(true);
}
async function stats(request: APIRequestContext): Promise<Stats> {
  const response = await request.get(`${gateway}/__limits-fixture`);
  expect(response.ok()).toBe(true);
  return response.json();
}
const limitsFor = (row: Locator) =>
  row.getByLabel("Account limits", { exact: true });

// Regression: a client-only fetch can look correct after hydration while the
// first paint has no quota. Disable JavaScript to prove the actual SSR contract.
// Next streams server markup into hidden segments and reveals them with an
// inline script, so no-JS checks inspect that markup rather than visibility.
test("account limits are present in the first server paint with UTC observation time", async ({
  browser,
  request,
}) => {
  await configure(request, "fresh");
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL!,
  });
  const violations: string[] = [];
  try {
    await useViewerSession(context);
    const page = await context.newPage();
    await installLoopbackOnlyNetworkGuard(page, violations);
    const response = await page.goto(
      "/dashboard/setup?workspace=rr-e2e-personal-viewer",
    );
    expect(response?.ok()).toBe(true);
    const markup = (await response!.text()).replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      "",
    );
    expect(markup).toContain('aria-valuenow="62.5"');
    const limits = limitsFor(
      page
        .locator("article")
        .filter({ hasText: FIXTURES.sourceLabels.viewerPrimary }),
    );
    await expect(limits).toContainText("62.5% left");
    await expect(limits).toContainText("UTC+00:00");
    await expect(
      limits.getByRole("progressbar", {
        name: "5h remaining",
        includeHidden: true,
      }),
    ).toHaveAttribute("aria-valuenow", "62.5");
    const reads = await stats(request);
    expect(reads.readAccounts).toContain(
      FIXTURES.gateway.accounts.viewerPrimary,
    );
    expect(reads.readAccounts).not.toContain(
      FIXTURES.gateway.accounts.foreignPrimary,
    );
    expect(
      browserRequestsFor(page).filter(
        (item) => item.path === "/api/dashboard/accounts/limits",
      ),
    ).toEqual([]);
    await expectNetworkViolations(violations);
  } finally {
    await context.close();
  }
});

// Regression: hydration/focus/countdown silently triggers an active read or reset
// manufactures a zero. Also proves cached reread is an explicit keyboard action.
test("account limits preserve observations across reset without automatic reads and allow one explicit cached reread", async ({
  page,
  context,
  request,
}, info) => {
  await configure(request, "fresh");
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await useViewerSession(context);
  await page.clock.install();
  await openAccounts(page, "rr-e2e-personal-viewer");
  const limits = limitsFor(
    sourceRow(page, FIXTURES.sourceLabels.viewerPrimary),
  );
  await expect(limits).toContainText("62.5% left");
  await page.waitForLoadState("networkidle");
  const initial = await stats(request);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Run interval callbacks across the source reset boundary without wall-clock
  // waiting, including the timer that renders the elapsed reset state.
  await page.clock.runFor(90_000);
  await expect(limits).toContainText("Reset pending");
  await expect(limits).toContainText("Outdated");
  await limits.screenshot({
    path: info.outputPath("account-limits-stale.png"),
  });
  await expect(limits).toContainText("62.5% left");
  expect((await stats(request)).reads).toBe(initial.reads);
  expect(
    browserRequestsFor(page).filter(
      (item) => item.path === "/api/dashboard/accounts/limits",
    ),
  ).toEqual([]);
  await expect(
    page.getByRole("button", { name: /Refresh.*provider|Update.*provider/i }),
  ).toHaveCount(0);
  const read = limits.getByRole("button", {
    name: "Reload saved limits",
    exact: true,
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/dashboard/accounts/limits",
  );
  await read.focus();
  await expect(read).toBeFocused();
  await read.press("Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json();
  expect(payload).toMatchObject({
    status: "ok",
    value: {
      status: "snapshot",
      windows: [
        {
          usedPercent: 37.5,
          remainingPercent: 62.5,
          observedAt: initial.observedAt,
        },
      ],
    },
  });
  expect(JSON.stringify(payload)).not.toMatch(
    /physicalGeneration|principalVersion|ownerRef|accountRef|authorizationEpoch|fixture-principal/,
  );
  expect((await stats(request)).reads).toBe(initial.reads + 1);
  const lastAsOf = await limits.getByText(/^As of:/).textContent();
  await configure(request, "unavailable");
  await read.click();
  await expect(limits.getByRole("status")).toContainText(
    "Could not reload saved limits.",
  );
  await expect(limits).toContainText("62.5% left");
  expect(await limits.getByText(/^As of:/).textContent()).toBe(lastAsOf);
  await limits.screenshot({
    path: info.outputPath("account-limits-reload-error.png"),
  });
  expect((await stats(request)).reads).toBe(1);
  await expectNetworkViolations(violations);
});

test("account limits partial and absent observations never imply free quota on mobile", async ({
  page,
  context,
  request,
}, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await useViewerSession(context);
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  for (const [mode, message] of [
    ["partial", "Remaining unknown"],
    ["unknown", "No limits saved yet"],
    ["unsupported", "Limits not supported"],
    ["unavailable", "Limits source unavailable"],
  ] as const) {
    await configure(request, mode);
    await openAccounts(page, "rr-e2e-personal-viewer");
    const limits = limitsFor(
      sourceRow(page, FIXTURES.sourceLabels.viewerPrimary),
    );
    await expect(limits).toContainText(message);
    await expect(limits.getByRole("progressbar")).toHaveCount(0);
    await expect(limits).not.toContainText(/remaining 100%|unlimited|7d/);
    if (mode === "partial") {
      await expect(limits).toContainText("Reset unknown");
      await expect(limits).toContainText("As of:");
    }
    if (mode === "unsupported")
      await expect(
        limits.getByRole("button", { name: "Reload saved limits" }),
      ).toHaveCount(0);
    await limits.screenshot({
      path: info.outputPath(`account-limits-mobile-${mode}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: info.outputPath("account-limits-mobile.png"),
    fullPage: true,
  });
  await expectNetworkViolations(violations);
});

// Regression: recipient admin inherits a donor's account-global quota via an
// otherwise authorized workspace binding. The fixture records actual HTTP reads.
test("account limits restrict shared rows before native reads and fence a delayed response on workspace switch", async ({
  page,
  context,
  request,
}) => {
  await configure(request, "fresh");
  await useViewerSession(context);
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await openAccounts(page, "rr-e2e-org-alpha");
  const donor = limitsFor(sourceRow(page, FIXTURES.sourceLabels.viewerPrimary));
  await expect(donor).toContainText("Limits visible to the owner only");
  await expect(donor.getByRole("progressbar")).toHaveCount(0);
  await expect(
    donor.getByRole("button", { name: "Reload saved limits" }),
  ).toHaveCount(0);
  const owned = limitsFor(sourceRow(page, FIXTURES.sourceLabels.orgAlpha));
  await expect(owned).toContainText("62.5% left");
  await page.waitForLoadState("networkidle");
  const initial = await stats(request);
  expect(initial.readAccounts).toContain(FIXTURES.gateway.accounts.orgAlpha);
  // The hidden Your accounts tab legitimately preloads the viewer's personal
  // account. The other user's shared account must never enter a native read.
  expect(initial.readAccounts).not.toContain(
    FIXTURES.gateway.accounts.otherPrimary,
  );
  await configure(request, "fresh");
  // Fetch the real authorized RR response before holding browser delivery. The
  // source SDK completes within its 3s deadline, even if navigation compiles.
  let captureResponse!: (response: APIResponse) => void;
  let rejectResponse!: (error: unknown) => void;
  const responseReady = new Promise<APIResponse>((resolve, reject) => {
    captureResponse = resolve;
    rejectResponse = reject;
  });
  let releaseResponse!: () => void;
  const barrier = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let deliveryDone!: () => void;
  let deliveryStarted = false;
  const delivery = new Promise<void>((resolve) => {
    deliveryDone = resolve;
  });
  await page.route("**/api/dashboard/accounts/limits?*", async (route) => {
    deliveryStarted = true;
    try {
      const response = await route.fetch();
      captureResponse(response);
      await barrier;
      await route.fulfill({ response });
    } catch (error) {
      rejectResponse(error);
      throw error;
    } finally {
      deliveryDone();
    }
  });
  try {
    await owned.getByRole("button", { name: "Reload saved limits" }).click();
    const response = await responseReady;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      value: { status: "snapshot", windows: [{ usedPercent: 37.5 }] },
    });
    expect(
      (await stats(request)).completedAccounts.filter(
        (account) => account === FIXTURES.gateway.accounts.orgAlpha,
      ),
    ).toHaveLength(1);
    await expect(
      owned.getByRole("button", { name: "Reload saved limits" }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(
      page.getByText("Connections available for RR E2E Org Bravo.", {
        exact: false,
      }),
    ).toBeVisible();
  } finally {
    releaseResponse();
    if (deliveryStarted) await delivery;
  }
  await expect(
    page.getByRole("progressbar", { name: "5h remaining" }),
  ).toHaveCount(0);
  // The viewer's own limits remain authorized in the hidden personal-access
  // dialog. Only the active workspace must reject the old organization result.
  await expect(
    page.locator('[aria-label="Account limits"]:visible').filter({
      hasText: /62.5% left/,
    }),
  ).toHaveCount(0);
  await expect(sourceRow(page, FIXTURES.sourceLabels.orgAlpha)).toHaveCount(0);
  await expect(
    limitsFor(sourceRow(page, FIXTURES.sourceLabels.viewerPrimary)),
  ).toContainText("Limits visible to the owner only");
  await expectNetworkViolations(violations);
});

// Visible density, keyboard disclosure, and numeric meaning belong to the real
// component: snapshots must not require reading the diagnostic timestamps.
test("account limits keep two windows compact with keyboard-accessible details", async ({
  page,
  context,
  request,
}, info) => {
  await configure(request, "two-windows");
  await useViewerSession(context);
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAccounts(page, "rr-e2e-personal-viewer");
  const row = sourceRow(page, FIXTURES.sourceLabels.viewerPrimary);
  const limits = limitsFor(row);
  await expect(limits).toContainText("62.5% left");
  await expect(limits).toContainText("12% left");
  await expect(
    limits.getByRole("progressbar", { name: "5h remaining" }),
  ).toHaveAttribute("aria-valuenow", "62.5");
  await expect(
    limits.getByRole("progressbar", { name: "7d remaining" }),
  ).toHaveAttribute("aria-valuenow", "12");
  const details = limits.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(limits.getByText(/^As of:/).first()).not.toBeVisible();
  await row.scrollIntoViewIfNeeded();
  expect((await limits.boundingBox())!.height).toBeLessThan(120);
  await limits.screenshot({
    path: info.outputPath("account-limits-compact-desktop.png"),
  });
  await page.screenshot({
    path: info.outputPath("account-limits-desktop-viewport.png"),
  });

  const before = await stats(request);
  const summary = limits.getByText("Details", { exact: true });
  await summary.focus();
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(limits.getByText(/^As of:/).first()).toBeVisible();
  await expect(limits).toContainText("37.5% used");
  await expect(limits).toContainText("88% used");
  await expect(limits).toContainText(/UTC[+-]\d{2}:\d{2}/);
  expect((await stats(request)).reads).toBe(before.reads);
  await limits.screenshot({
    path: info.outputPath("account-limits-details-desktop.png"),
  });
  await summary.press("Enter");
  await expect(details).not.toHaveAttribute("open", "");

  await page.setViewportSize({ width: 390, height: 844 });
  await row.scrollIntoViewIfNeeded();
  await expect(limits).toContainText("62.5% left");
  await expect(limits).toContainText("12% left");
  const bounds = (await limits.boundingBox())!;
  expect(bounds.height).toBeLessThan(160);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await limits.screenshot({
    path: info.outputPath("account-limits-compact-mobile.png"),
  });
  await page.screenshot({
    path: info.outputPath("account-limits-mobile-viewport.png"),
  });
  await summary.click();
  await expect(limits.getByText(/^As of:/).first()).toBeVisible();
  await limits.screenshot({
    path: info.outputPath("account-limits-details-mobile.png"),
  });
  await expectNetworkViolations(violations);
});
