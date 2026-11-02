import { expect, test, type Page, type Locator } from "@playwright/test";
import pg from "pg";
import { FIXTURES } from "../contracts.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
} from "./support.ts";
const LONG_MODEL =
  "model-gamma/experimental-long-requested-model-identifier-for-responsive-overflow-acceptance-2026-10";
const databaseUrl = process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL;
test.skip(
  !databaseUrl,
  "Requires isolated accounts-reference database harness.",
);
// Expectations below are fixed fixture arithmetic, independent of the report aggregators.
test("provider usage overview keeps complete period totals, charts, models and runs across pages", async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  const pageErrors: string[] = [];
  const reportRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/dashboard/provider-usage")
      reportRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const days = [-2, -1, 0].map((offset) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
  const [firstDay, secondDay, lastDay] = days as [string, string, string];
  const sharedRun =
    "rr-e2e-overview-run-crossday-long-identity-for-accessible-disclosure-2026-10";
  try {
    await db.query(
      `UPDATE "WorkspaceMember" SET role='member' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    for (let index = 0; index < 104; index++) {
      await seedOverviewCall(db, {
        suffix: `bulk-${index.toString().padStart(3, "0")}`,
        day: firstDay,
        provider: "codex",
        model: "model-alpha",
        total: 2,
        amount: "0.01",
      });
    }
    await seedOverviewCall(db, {
      suffix: "cross-a",
      day: firstDay,
      provider: "codex",
      model: "model-alpha",
      total: 100,
      amount: "0.1",
      runId: sharedRun,
      observed: "observed-alpha-v2",
    });
    await seedOverviewCall(db, {
      suffix: "cross-b",
      day: secondDay,
      provider: "anthropic",
      model: "model-beta",
      total: 200,
      amount: "0.2",
      currency: "EUR",
      route: "gateway",
      runId: sharedRun,
    });
    await seedOverviewCall(db, {
      suffix: "cross-c",
      day: lastDay,
      provider: "gemini",
      model: LONG_MODEL,
      total: 300,
      amount: "0.3",
      basis: "estimated",
      runId: sharedRun,
    });
    await seedOverviewCall(db, {
      suffix: "cross-unknown",
      day: lastDay,
      provider: "codex",
      model: "model-alpha",
      total: null,
      amount: null,
      runId: sharedRun,
      observed: null,
    });
    await seedOverviewCall(db, {
      suffix: "zero",
      day: lastDay,
      provider: "codex",
      model: "model-zero",
      total: 0,
      amount: "0",
    });
    await seedOverviewCall(db, {
      suffix: "unknown",
      day: lastDay,
      provider: "gemini",
      model: null,
      total: null,
      amount: null,
      runId: null,
      observed: null,
    });
    await seedOverviewCall(db, {
      suffix: "member",
      day: secondDay,
      provider: "anthropic",
      model: "model-beta",
      total: 50,
      amount: "0.05",
      currency: "EUR",
      actorId: FIXTURES.users.other,
    });
    await seedOverviewCall(db, {
      suffix: "diagnostic",
      day: lastDay,
      provider: "codex",
      model: "diagnostic-model",
      total: 777,
      amount: "9",
      purpose: "diagnostic",
    });
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
    const usage = page.getByRole("region", {
      name: "Provider usage",
      exact: true,
    });
    const kpi = (name: string) => usageKpi(usage, name);
    await expect(kpi("Known tokens")).toContainText("858");
    await expect(kpi("Provider requests")).toContainText("111");
    await expect(kpi("Review runs")).toContainText("107");
    await expect(
      usage.getByRole("combobox", { name: "Cost currency", exact: true }),
    ).toContainText("USD");
    await expect(kpi("Known cost")).toContainText("1.14 USD");
    await expect(kpi("Known cost")).toContainText("0.3 USD");
    await expect(kpi("Known cost")).not.toContainText("EUR");
    await expect(kpi("Known cost")).not.toContainText("0.25");
    await expect(
      usage.getByText("Freshness unavailable", { exact: true }),
    ).toBeVisible();
    const query = new URLSearchParams({
      workspace: FIXTURES.workspaces.orgAlpha,
      purpose: "review",
    });
    const api = async (
      extra: Record<string, string> = {},
      expectedScope: {
        actorId: string;
        effectiveAccess: "admin" | "member";
      } = { actorId: FIXTURES.users.viewer, effectiveAccess: "admin" },
    ) => {
      const response = await context.request.get(
        `/api/dashboard/provider-usage?${new URLSearchParams({ ...Object.fromEntries(query), ...extra })}`,
      );
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      const payload = await response.json();
      expect(payload).toEqual({
        scope: {
          ...expectedScope,
          workspaceId: FIXTURES.workspaces.orgAlpha,
        },
        report: expect.any(Object),
      });
      return payload.report;
    };
    const payload = await api();
    expect(payload.totals).toMatchObject({
      providerAttempts: 111,
      logicalRuns: 107,
      tokens: { total: 858 },
      unknownCostCount: 2,
    });
    expect(payload.totals.costs).toEqual(
      expect.arrayContaining([
        { currency: "USD", basis: "source_reported", amount: "1.14" },
        { currency: "EUR", basis: "source_reported", amount: "0.25" },
        { currency: "USD", basis: "estimated", amount: "0.3" },
      ]),
    );
    expect(
      payload.overview.topModels.tokens.map(
        (row: { requestedModel: string }) => row.requestedModel,
      ),
    ).toEqual(["model-alpha", LONG_MODEL, "model-beta"]);
    expect(payload.overview.daily).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          day: firstDay,
          provider: "codex",
          totals: expect.objectContaining({
            providerAttempts: 105,
            tokens: expect.objectContaining({ total: 308 }),
          }),
        }),
        expect.objectContaining({
          day: secondDay,
          provider: "anthropic",
          totals: expect.objectContaining({
            providerAttempts: 2,
            tokens: expect.objectContaining({ total: 250 }),
          }),
        }),
        expect.objectContaining({
          day: lastDay,
          provider: "gemini",
          totals: expect.objectContaining({
            providerAttempts: 2,
            tokens: expect.objectContaining({ total: 300 }),
          }),
        }),
        expect.objectContaining({
          day: lastDay,
          provider: "codex",
          totals: expect.objectContaining({
            providerAttempts: 2,
            tokens: expect.objectContaining({ total: 0 }),
          }),
        }),
      ]),
    );
    expect(payload.rows).toHaveLength(100);
    expect(payload.nextCursor).toBeTruthy();
    expect(payload.overview.runs).toHaveLength(100);
    expect(payload.overview.nextRunCursor).toBeTruthy();
    expect(
      payload.overview.models.find(
        (row: { requestedModel: string | null }) =>
          row.requestedModel === "model-zero",
      ),
    ).toMatchObject({
      totals: {
        providerAttempts: 1,
        tokens: { total: 0 },
        costs: [{ currency: "USD", basis: "source_reported", amount: "0" }],
      },
    });
    expect(
      payload.overview.models.find(
        (row: { requestedModel: string | null }) => row.requestedModel === null,
      ),
    ).toMatchObject({
      totals: {
        providerAttempts: 1,
        tokens: { total: null },
        unknownCostCount: 1,
      },
      hasUnknownObservedModel: true,
    });
    expect(payload.overview.hasDirectObservations).toBe(true);
    expect(payload.overview.observationsWithoutRunId).toBe(1);
    expect(JSON.stringify(payload)).not.toMatch(
      /authorizationId|actorId|apiKey|publicKey|rr-e2e-authorization/,
    );
    const next = await api({
      after: payload.nextCursor,
      runAfter: payload.overview.nextRunCursor,
    });
    expect(next.rows).toHaveLength(11);
    expect(next.overview.runs).toHaveLength(7);
    expect(next.totals).toEqual(payload.totals);
    expect(next.overview.daily).toEqual(payload.overview.daily);
    expect(next.overview.topModels).toEqual(payload.overview.topModels);
    const allRuns = [...payload.overview.runs, ...next.overview.runs];
    expect(allRuns.find((row) => row.runId === sharedRun)).toMatchObject({
      firstOccurredAt: `${firstDay}T00:00:01.000Z`,
      lastOccurredAt: `${lastDay}T00:00:01.000Z`,
      totals: { providerAttempts: 4, tokens: { total: 600 } },
      identities: expect.arrayContaining([
        { provider: "codex", requestedModel: "model-alpha" },
        { provider: "anthropic", requestedModel: "model-beta" },
        { provider: "gemini", requestedModel: LONG_MODEL },
      ]),
      hasUnknownObservedModel: true,
    });
    const filtered = await api({ provider: "codex", model: "model-alpha" });
    expect(filtered.totals).toMatchObject({
      providerAttempts: 106,
      logicalRuns: 105,
      tokens: { total: 308 },
    });
    const filteredNext = await api({
      provider: "codex",
      model: "model-alpha",
      runAfter: filtered.overview.nextRunCursor,
    });
    expect(
      [...filtered.overview.runs, ...filteredNext.overview.runs].find(
        (row) => row.runId === sharedRun,
      ),
    ).toMatchObject({
      identities: [{ provider: "codex", requestedModel: "model-alpha" }],
      routes: ["direct"],
      totals: { providerAttempts: 2, tokens: { total: 100 } },
    });
    await expect(
      usage.getByRole("table", { name: "Requested model usage", exact: true }),
    ).toContainText("model-alpha");
    await expect(
      usage.getByRole("table", { name: "Requested model usage", exact: true }),
    ).toContainText("observed-alpha-v2");
    await expect(
      usage.getByRole("table", { name: "Requested model usage", exact: true }),
    ).toContainText("Unknown requested model");
    const models = usageBreakdown(usage, "models");
    await expect(models).not.toContainText(/\bEUR\b/);
    await expect(models).toContainText("No USD amount");
    const requestsBeforeCurrency = reportRequests.length;
    await chooseUsageOption(page, "Cost currency", "EUR");
    await expect(kpi("Known cost")).toContainText("0.25 EUR");
    await expect(kpi("Known cost")).not.toContainText("USD");
    await expect(models).toContainText("0.05 EUR");
    await expect(models).toContainText("0.2 EUR");
    await expect(models).not.toContainText(/\bUSD\b/);
    await expectBreakdownCount(usage, "models", 6);
    await expect(kpi("Known tokens")).toContainText("858");
    await expect(kpi("Provider requests")).toContainText("111");
    await expect(kpi("Review runs")).toContainText("107");
    await settleCurrencyPresentation(page);
    expect(reportRequests).toHaveLength(requestsBeforeCurrency);
    // A still-available currency survives a real server filter change.
    await chooseUsageOption(page, "Route", "Direct");
    await expect(kpi("Known tokens")).toContainText("658");
    await expect(kpi("Provider requests")).toContainText("110");
    await expect(
      usage.getByRole("combobox", { name: "Cost currency", exact: true }),
    ).toContainText("EUR");
    await expect(kpi("Known cost")).toContainText("0.05 EUR");
    await chooseUsageOption(page, "Route", "All routes");
    await expect(kpi("Known tokens")).toContainText("858");
    await expect(
      usage.getByRole("combobox", { name: "Cost currency", exact: true }),
    ).toContainText("EUR");
    const requestsBeforeUsd = reportRequests.length;
    await chooseUsageOption(page, "Cost currency", "USD");
    await expect(kpi("Known cost")).toContainText("1.14 USD");
    await expect(kpi("Known cost")).toContainText("0.3 USD");
    await settleCurrencyPresentation(page);
    expect(reportRequests).toHaveLength(requestsBeforeUsd);
    await expect(
      usage.getByLabel("Daily usage chart", { exact: true }),
    ).toBeVisible();
    await expect(
      usage.getByLabel("Requested models chart", { exact: true }),
    ).toBeVisible();
    const dailyChart = usage.getByLabel("Daily usage chart", { exact: true });
    await dailyChart.focus();
    for (let index = 0; index < 30; index++)
      await dailyChart.press("ArrowRight");
    await expect(usage.getByRole("status")).toContainText(`${lastDay} UTC`);
    await expect(usage.getByRole("status")).toContainText("gemini: 300");
    await page.getByRole("heading", { name: "Usage", exact: true }).click();
    for (const [width, height] of [
      [1440, 1000],
      [1024, 768],
      [390, 844],
      [320, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectBreakdownCount(usage, "models", 6);
      if (width <= 1024) await expectSummaryMetrics(usage, "models");
      if (width === 390) {
        const alphaSummary = usage
          .getByRole("region", { name: "Model usage summaries", exact: true })
          .getByRole("listitem")
          .filter({ hasText: "codex / model-alpha" });
        await expect(alphaSummary).toContainText("1.14 USD");
        await expect(
          alphaSummary.getByText("Some cost unknown", { exact: true }),
        ).toBeVisible();
        const fullModel = usage
          .getByRole("region", { name: "Model usage summaries", exact: true })
          .locator("summary")
          .filter({ hasText: /^Full requested model$/ });
        await fullModel.focus();
        await fullModel.press("Enter");
        await expect(
          fullModel
            .locator("..")
            .getByText(`gemini / ${LONG_MODEL}`, { exact: true }),
        ).toBeVisible();
        await fullModel.press("Space");
        await expect(fullModel.locator("..")).not.toHaveAttribute("open");
      }
      await expectCompactDashboardFooter(page);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.evaluate(() =>
        window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: info.outputPath(`usage-tokens-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.evaluate(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: info.outputPath("usage-tokens-light-desktop.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Light theme", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use system theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const zoomContext = await browser.newContext({
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 2,
      hasTouch: true,
      baseURL: process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL!,
    });
    try {
      await useViewerSession(zoomContext);
      const zoom = await zoomContext.newPage();
      zoom.on("pageerror", (error) => pageErrors.push(error.message));
      await installLoopbackOnlyNetworkGuard(zoom, violations);
      await zoom.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
      await expect(
        usageBreakdown(
          zoom.getByRole("region", { name: "Provider usage", exact: true }),
          "models",
        ),
      ).toBeVisible();
      const touchModel = zoom
        .getByRole("region", { name: "Model usage summaries", exact: true })
        .locator("summary")
        .filter({ hasText: /^Full requested model$/ });
      await touchModel.tap();
      await expect(
        touchModel
          .locator("..")
          .getByText(`gemini / ${LONG_MODEL}`, { exact: true }),
      ).toBeVisible();
      await touchModel.tap();
      await expect
        .poll(() =>
          zoom.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await zoom.evaluate(() =>
        window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
      );
      await zoom.screenshot({
        path: info.outputPath("usage-tokens-640-dpr2.png"),
        fullPage: true,
      });
      const zoomUsage = zoom.getByRole("region", {
        name: "Provider usage",
        exact: true,
      });
      await zoomUsage.getByRole("tab", { name: "Runs", exact: true }).tap();
      await expectBreakdownCount(zoomUsage, "runs", 100);
      await zoomUsage
        .getByRole("button", { name: "Next run page", exact: true })
        .tap();
      await expectBreakdownCount(zoomUsage, "runs", 7);
      const touchRun = usageBreakdown(zoomUsage, "runs")
        .getByRole("listitem")
        .filter({ hasText: sharedRun });
      await touchRun
        .locator("summary")
        .filter({ hasText: /^Run details$/ })
        .tap();
      await zoomContext.grantPermissions(["clipboard-read", "clipboard-write"]);
      await touchRun
        .getByRole("button", { name: "Copy run ID", exact: true })
        .tap();
      await expect(
        touchRun.getByText("Run ID copied", { exact: true }),
      ).toBeVisible();
      expect(await zoom.evaluate(() => navigator.clipboard.readText())).toBe(
        sharedRun,
      );
    } finally {
      await zoomContext.close();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await usage.getByRole("button", { name: "Cost", exact: true }).click();
    const costBasis = usage.getByRole("combobox", {
      name: "Cost basis",
      exact: true,
    });
    await expect(costBasis).toBeVisible();
    await costBasis.click();
    await expect(page.getByRole("option")).toHaveCount(2);
    await expect(
      page.getByRole("option", { name: "Estimated", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Reported", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: /EUR/ })).toHaveCount(0);
    await page.getByRole("option", { name: "Estimated", exact: true }).click();
    await expect(
      usage.getByLabel("Requested models chart", { exact: true }),
    ).toContainText("0.3 USD Estimated");
    for (const currency of ["USD", "EUR"] as const) {
      if (currency === "EUR")
        await chooseUsageOption(page, "Cost currency", currency);
      await expect(kpi("Known cost")).toContainText(
        currency === "USD" ? "1.14 USD" : "0.25 EUR",
      );
      await expect(kpi("Known cost")).not.toContainText(
        currency === "USD" ? "EUR" : "USD",
      );
      await expect(kpi("Known tokens")).toContainText("858");
      await expect(kpi("Provider requests")).toContainText("111");
      await expect(kpi("Review runs")).toContainText("107");
      if (currency === "EUR") {
        await expect(costBasis).toHaveCount(0);
        await expect(
          usage.getByLabel("Requested models chart", { exact: true }),
        ).toContainText("0.25 EUR Reported");
        await dailyChart.focus();
        for (let index = 0; index < 30; index++)
          await dailyChart.press("ArrowRight");
        await dailyChart.press("ArrowLeft");
        await expect(usage.getByRole("status")).toContainText(
          `${secondDay} UTC`,
        );
        await expect(usage.getByRole("status")).toContainText("0.25 EUR");
        await expect(usage.getByRole("status")).not.toContainText("USD");
        await page.getByRole("heading", { name: "Usage", exact: true }).click();
      }
      for (const [width, height] of [
        [1440, 1000],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expectBreakdownCount(usage, "models", 6);
        await expect(models).not.toContainText(
          currency === "USD" ? /\bEUR\b/ : /\bUSD\b/,
        );
        await expect(models).toContainText(
          currency === "USD" ? "0.3 USD" : "0.2 EUR",
        );
        if (width === 390) await expectSummaryMetrics(usage, "models");
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBe(true);
        await page.evaluate(() =>
          window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
        );
        await page.screenshot({
          path: info.outputPath(`usage-cost-${currency}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await usage.getByRole("tab", { name: "Runs", exact: true }).click();
    await expectBreakdownCount(usage, "runs", 100);
    await usage
      .getByRole("button", { name: "Next run page", exact: true })
      .click();
    await expectBreakdownCount(usage, "runs", 7);
    await expect(kpi("Known tokens")).toContainText("858");
    const runs = usageBreakdown(usage, "runs");
    await expect(runs).toContainText("0.2 EUR");
    await expect(runs).toContainText("0.05 EUR");
    await expect(runs).not.toContainText(/\bUSD\b/);
    const requestsBeforeRunCurrency = reportRequests.length;
    await chooseUsageOption(page, "Cost currency", "USD");
    await expect(runs).toContainText("0.1 USD");
    await expect(runs).toContainText("0.3 USD");
    await expect(runs).not.toContainText(/\bEUR\b/);
    await expectBreakdownCount(usage, "runs", 7);
    await chooseUsageOption(page, "Cost currency", "EUR");
    await expect(runs).toContainText("0.2 EUR");
    await settleCurrencyPresentation(page);
    expect(reportRequests).toHaveLength(requestsBeforeRunCurrency);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectSummaryMetrics(usage, "runs");
    const sharedRunSummary = runs
      .getByRole("listitem")
      .filter({ hasText: sharedRun });
    await expect(sharedRunSummary).toContainText("0.2 EUR");
    await expect(
      sharedRunSummary.getByText("Some cost unknown", { exact: true }),
    ).toBeVisible();
    const runDetails = sharedRunSummary
      .locator("summary")
      .filter({ hasText: /^Run details$/ });
    await expect(sharedRunSummary.locator("p").first()).toContainText("…");
    await runDetails.focus();
    await runDetails.press("Enter");
    await expect(runDetails.locator("..").locator("code")).toBeVisible();
    await expect(runDetails.locator("..").locator("code")).toHaveText(
      sharedRun,
    );
    await expect(sharedRunSummary).toContainText(
      /\b[A-Z][a-z]{2} \d{1,2}, \d{4}.*UTC/,
    );
    await expect(sharedRunSummary).not.toContainText(
      /T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const copyRun = sharedRunSummary.getByRole("button", {
      name: "Copy run ID",
      exact: true,
    });
    await copyRun.focus();
    await copyRun.press("Enter");
    await expect(
      sharedRunSummary.getByText("Run ID copied", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      sharedRun,
    );
    await runDetails.press("Enter");
    await page.evaluate(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: info.outputPath("usage-runs-mobile.png"),
      fullPage: true,
    });
    await chooseUsageOption(page, "Provider", "codex");
    await chooseUsageOption(page, "Requested model", "model-alpha");
    await expect(kpi("Known tokens")).toContainText("308");
    await expect(kpi("Provider requests")).toContainText("106");
    await chooseUsageOption(page, "Route", "Gateway");
    await expect(
      usage.getByText("No measured observations", { exact: false }),
    ).toBeVisible();
    await expect(
      usage.getByLabel("Daily usage chart", { exact: true }),
    ).toHaveCount(0);
    await expect(
      usage.getByRole("region", { name: "Daily provider usage", exact: true }),
    ).toHaveCount(0);
    await expect(
      usage.getByLabel("Requested models chart", { exact: true }),
    ).toHaveCount(0);
    await expect(
      usage.getByRole("list", {
        name: "Requested provider legend",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      usage.getByText("Freshness unavailable", { exact: true }),
    ).toBeVisible();
    expect(
      await usage
        .getByText("No measured observations", { exact: false })
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(120);
    await expectCompactDashboardFooter(page);
    await page.evaluate(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: info.outputPath("usage-empty-mobile.png"),
      fullPage: true,
    });
    await chooseUsageOption(page, "Route", "All routes");
    await chooseUsageOption(page, "Provider", "All providers");
    await chooseUsageOption(page, "Purpose", "Diagnostics");
    await expect(kpi("Known tokens")).toContainText("777");
    await expect(kpi("Runs")).toContainText("1");
    await chooseUsageOption(page, "Purpose", "Review");
    await chooseUsageOption(page, "Cost currency", "EUR");
    await usage.getByLabel("Details", { exact: true }).click();
    await expect(
      usage.getByRole("table", { name: "Daily usage data", exact: true }),
    ).toContainText("No observations; coverage unknown");
    await expect(
      usage
        .getByRole("table", { name: "Usage observations", exact: true })
        .getByRole("row"),
    ).toHaveCount(101);
    await usage
      .getByRole("button", { name: "Next observation page", exact: true })
      .click();
    await expect(
      usage
        .getByRole("table", { name: "Usage observations", exact: true })
        .getByRole("row"),
    ).toHaveCount(12);
    await expect(kpi("Known tokens")).toContainText("858");
    const dailyValues = usage.getByRole("table", {
      name: "Daily usage data",
      exact: true,
    });
    const observations = usage.getByRole("table", {
      name: "Usage observations",
      exact: true,
    });
    await expect(dailyValues).toContainText("0.25 EUR");
    await expect(dailyValues).not.toContainText(/\bUSD\b/);
    await expect(observations).toContainText("0.2 EUR");
    await expect(observations).toContainText("0.05 EUR");
    await expect(observations).not.toContainText(/\bUSD\b/);
    const requestsBeforeDetailCurrency = reportRequests.length;
    await chooseUsageOption(page, "Cost currency", "USD");
    await expect(observations).toContainText("0.1 USD");
    await expect(observations).toContainText("0.3 USD");
    await expect(observations).not.toContainText(/\bEUR\b/);
    await expect(dailyValues).not.toContainText(/\bEUR\b/);
    await expect(observations.getByRole("row")).toHaveCount(12);
    await chooseUsageOption(page, "Cost currency", "EUR");
    await expect(dailyValues).toContainText("0.25 EUR");
    await settleCurrencyPresentation(page);
    expect(reportRequests).toHaveLength(requestsBeforeDetailCurrency);
    await page.evaluate(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: info.outputPath("usage-details-mobile.png"),
      fullPage: true,
    });
    await usage.getByLabel("Usage run", { exact: true }).fill(sharedRun);
    await expect(kpi("Known tokens")).toContainText("600");
    await expect(kpi("Provider requests")).toContainText("4");
    await expect(
      usage
        .getByRole("table", { name: "Usage observations", exact: true })
        .getByRole("row"),
    ).toHaveCount(5);
    await openUsageDetails(usage);
    await usage.getByLabel("Usage run", { exact: true }).fill("");
    await expect(kpi("Known tokens")).toContainText("858");
    await openUsageDetails(usage);
    await usage
      .getByLabel("Usage binding", { exact: true })
      .fill("rr-e2e-no-matching-binding");
    await expect(
      usage.getByText("No measured observations", { exact: false }),
    ).toBeVisible();
    await openUsageDetails(usage);
    await usage.getByLabel("Usage binding", { exact: true }).fill("");
    await expect(kpi("Known tokens")).toContainText("858");
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().includes("/api/dashboard/provider-usage") &&
        response.request().method() === "GET",
    );
    await usage.getByRole("button", { name: "Refresh", exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(kpi("Known tokens")).toContainText("858");
    await chooseUsageOption(page, "Period", "Custom dates");
    await usage.getByLabel("Usage from", { exact: true }).fill(firstDay);
    await usage.getByLabel("Usage to", { exact: true }).fill(lastDay);
    const applied = page.waitForResponse(
      (response) =>
        response.url().includes("/api/dashboard/provider-usage") &&
        response.request().method() === "GET",
    );
    await usage
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
    const appliedResponse = await applied;
    const customUrl = new URL(appliedResponse.url());
    expect(customUrl.searchParams.get("from")).toBe(
      `${firstDay}T00:00:00.000Z`,
    );
    const nextDay = new Date(`${lastDay}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    expect(customUrl.searchParams.get("to")).toBe(nextDay.toISOString());
    await expect(kpi("Known tokens")).toContainText("858");
    const customRefresh = page.waitForResponse(
      (response) =>
        response.url().includes("/api/dashboard/provider-usage") &&
        response.request().method() === "GET",
    );
    await usage.getByRole("button", { name: "Refresh", exact: true }).click();
    const customRefreshUrl = new URL((await customRefresh).url());
    expect(customRefreshUrl.searchParams.get("from")).toBe(
      customUrl.searchParams.get("from"),
    );
    expect(customRefreshUrl.searchParams.get("to")).toBe(
      customUrl.searchParams.get("to"),
    );
    // Reset dimensions and both cursors without losing the chosen UTC interval or purpose.
    await chooseUsageOption(page, "Provider", "codex");
    await chooseUsageOption(page, "Requested model", "model-alpha");
    await chooseUsageOption(page, "Route", "Direct");
    await expect(kpi("Known tokens")).toContainText("308");
    await usage.getByRole("tab", { name: "Runs", exact: true }).click();
    await usage
      .getByRole("button", { name: "Next run page", exact: true })
      .click();
    await expectBreakdownCount(usage, "runs", 5);
    await openUsageDetails(usage);
    await usage
      .getByRole("button", { name: "Next observation page", exact: true })
      .click();
    await expect(observations.getByRole("row")).toHaveCount(7);
    await usage
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(kpi("Known tokens")).toContainText("858");
    await expectBreakdownCount(usage, "runs", 100);
    await openUsageDetails(usage);
    await expect(observations.getByRole("row")).toHaveCount(101);
    await expect(
      usage.getByRole("combobox", { name: "Provider", exact: true }),
    ).toContainText("All providers");
    await expect(
      usage.getByRole("combobox", { name: "Requested model", exact: true }),
    ).toContainText("All models");
    await expect(
      usage.getByRole("combobox", { name: "Route", exact: true }),
    ).toContainText("All routes");
    await expect(
      usage.getByRole("combobox", { name: "Period", exact: true }),
    ).toContainText("Custom dates");
    await expect(usage.getByLabel("Usage from", { exact: true })).toHaveValue(
      firstDay,
    );
    await expect(usage.getByLabel("Usage to", { exact: true })).toHaveValue(
      lastDay,
    );
    await expect(
      usage.getByRole("combobox", { name: "Purpose", exact: true }),
    ).toContainText("Review");
    await chooseUsageOption(page, "Purpose", "Diagnostics");
    await chooseUsageOption(page, "Provider", "codex");
    await expect(kpi("Known tokens")).toContainText("777");
    await usage
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(
      usage.getByRole("combobox", { name: "Purpose", exact: true }),
    ).toContainText("Diagnostics");
    await expect(kpi("Known tokens")).toContainText("777");
    await expect(
      usage.getByRole("combobox", { name: "Period", exact: true }),
    ).toContainText("Custom dates");
    await chooseUsageOption(page, "Purpose", "Review");
    await expect(kpi("Known tokens")).toContainText("858");
    await context.clearCookies();
    await useOtherSession(context);
    const member = await api(
      {},
      {
        actorId: FIXTURES.users.other,
        effectiveAccess: "member",
      },
    );
    expect(member.totals).toMatchObject({
      providerAttempts: 1,
      logicalRuns: 1,
      tokens: { total: 50 },
    });
    const forbidden = await context.request.get(
      `/api/dashboard/provider-usage?workspace=${FIXTURES.workspaces.orgBravo}`,
    );
    expect(forbidden.status()).toBe(403);
    expect(forbidden.headers()["cache-control"]).toBe("private, no-store");
    expect(await forbidden.json()).toEqual({ error: "usage_access_denied" });
    await page.reload();
    await expect(kpi("Known tokens")).toContainText("50");
    await page
      .getByRole("contentinfo", { name: "Dashboard footer", exact: true })
      .getByRole("link", { name: "Support", exact: true })
      .click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(
      page.getByRole("contentinfo", { name: "Dashboard footer", exact: true }),
    ).toHaveCount(0);
    const publicFooter = page.getByRole("contentinfo");
    await expect(
      publicFooter.getByText("Product", { exact: true }),
    ).toBeVisible();
    await expect(
      publicFooter.getByText("Trust", { exact: true }),
    ).toBeVisible();
    expect(violations).toEqual([]);
    expect(pageErrors).toEqual([]);
    for (const url of reportRequests) {
      expect(new URL(url).searchParams.has("currency")).toBe(false);
      expect(new URL(url).searchParams.has("costCurrency")).toBe(false);
    }
  } finally {
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId" LIKE 'rr-e2e-usage-overview-%'`,
    );
    await db.query(
      `UPDATE "WorkspaceMember" SET role='admin' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    await db.end();
  }
});

test("provider usage isolates workspace navigation and reloads stable known totals", async ({
  page,
  context,
}) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  try {
    await seedKnownCall(
      db,
      "navigation-alpha",
      FIXTURES.workspaces.orgAlpha,
      12,
    );
    await seedKnownCall(
      db,
      "navigation-bravo",
      FIXTURES.workspaces.orgBravo,
      84,
    );
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
    const usage = page.getByRole("region", {
      name: "Provider usage",
      exact: true,
    });
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^12\b/ }),
    ).toBeVisible();
    // Populate a client query as well as the server-rendered initial report.
    await chooseUsageOption(page, "Route", "Direct");
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^12\b/ }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^84\b/ }),
    ).toBeVisible();
    await chooseUsageOption(page, "Route", "Direct");
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^84\b/ }),
    ).toBeVisible();
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^12\b/ }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: /RR E2E Org Alpha/ }).click();
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^12\b/ }),
    ).toBeVisible();
    await seedKnownCall(
      db,
      "navigation-bravo-new",
      FIXTURES.workspaces.orgBravo,
      16,
    );
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^100\b/ }),
    ).toBeVisible();
    await chooseUsageOption(page, "Route", "Direct");
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^100\b/ }),
    ).toBeVisible();
    await expect(
      usageKpi(usage, "Provider requests").filter({ hasText: /^2\b/ }),
    ).toBeVisible();
    await page.reload();
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^100\b/ }),
    ).toBeVisible();
    await expect(
      usageKpi(usage, "Provider requests").filter({ hasText: /^2\b/ }),
    ).toBeVisible();
    await expect(
      usageKpi(usage, "Known cost").filter({
        hasText: /0\.02 USD.*Reported/,
      }),
    ).toBeVisible();
    expect(violations).toEqual([]);
  } finally {
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId" LIKE 'rr-e2e-usage-navigation-%'`,
    );
    await db.end();
  }
});

test("provider usage renders native lag and partial producer coverage truthfully", async ({
  page,
  context,
}) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  const asOf = new Date(Date.now() - 120_000).toISOString();
  const coveredFrom = new Date(Date.now() - 3_600_000).toISOString();
  const retryAt = new Date(Date.now() + 3_600_000).toISOString();
  try {
    await seedKnownCall(db, "coverage", FIXTURES.workspaces.orgAlpha, 42);
    await db.query(
      `INSERT INTO "UsageSourceCheckpoint" ("sourceInstance","workspaceId","coveredFrom","asOf","failureCount","nextAttemptAt","lastErrorCode") VALUES ('rr-e2e-usage-native',$1,$2,$3,1,$4,'gateway_unavailable')`,
      [FIXTURES.workspaces.orgAlpha, coveredFrom, asOf, retryAt],
    );
    await db.query(
      `INSERT INTO "ProviderUsageGrant" (id,"tokenHash","workspaceId","invocationId","repositoryId","runId","runAttempt","authorizationId","actorId","producerDigest","workflowIdentity","jobIdentity","publicKey","issuedAt","expiresAt","producerCoverage") VALUES ('rr-e2e-usage-grant','rr-e2e-usage-token-hash',$1,'rr-e2e-usage-coverage-invocation','rr-e2e-repository','rr-e2e-usage-coverage-run',1,'rr-e2e-authorization',$2,'rr-e2e-digest','rr-e2e-workflow','rr-e2e-job','rr-e2e-unused-key',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 hour',$3)`,
      [
        FIXTURES.workspaces.orgAlpha,
        FIXTURES.users.viewer,
        JSON.stringify({
          schemaVersion: 1,
          revision: 1,
          state: "partial",
          reason: "spool_overflow",
          droppedEvents: 3,
          occurredAt: asOf,
        }),
      ],
    );
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/dashboard?section=usage&workspace=rr-e2e-org-alpha");
    const usage = page.getByRole("region", {
      name: "Provider usage",
      exact: true,
    });
    await expect(
      usage.getByText(`Updated ${expectedHumanUtc(asOf)}`, { exact: true }),
    ).toBeVisible();
    await usage.getByLabel("Details", { exact: true }).click();
    await expect(
      usage.getByText(/Source lag: [\d.]+s \(native reconciliation\)/),
    ).toBeVisible();
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      `Native source coverage from ${expectedHumanUtc(coveredFrom)}; as of ${expectedHumanUtc(asOf)}`,
    );
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      `retry at ${expectedHumanUtc(retryAt)}`,
    );
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      "last source error: gateway_unavailable",
    );
    await expect(usage.getByLabel("Producer delivery coverage")).toHaveText(
      "Runtime delivery: partial (spool_overflow, 3 dropped events)",
    );
    await expect(
      usageKpi(usage, "Known tokens").filter({ hasText: /^42\b/ }),
    ).toBeVisible();
    await expect(
      usage.getByRole("link", { name: "Account limits are shown in Accounts" }),
    ).toBeVisible();
    await expect(usage.getByLabel("Usage source coverage")).toContainText(
      "reported observations only; transport completeness varies",
    );
    expect(violations).toEqual([]);
  } finally {
    await db.query(
      `DELETE FROM "ProviderUsageGrant" WHERE id='rr-e2e-usage-grant'`,
    );
    await db.query(
      `DELETE FROM "UsageSourceCheckpoint" WHERE "sourceInstance"='rr-e2e-usage-native'`,
    );
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId"='rr-e2e-usage-coverage'`,
    );
    await db.end();
  }
});

test("provider usage operator report permits administrators and denies members and signed-out users", async ({
  page,
  context,
}) => {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const violations: string[] = [];
  try {
    await seedKnownCall(db, "operator-alpha", FIXTURES.workspaces.orgAlpha, 12);
    await seedKnownCall(db, "operator-bravo", FIXTURES.workspaces.orgBravo, 84);
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.goto("/operator/provider-usage");
    await expect(
      page.getByRole("heading", {
        name: "Operator provider usage",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator("dl").getByText("96", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("All users across active workspaces.", { exact: false }),
    ).toBeVisible();
    const allowed = await context.request.get("/api/operator/provider-usage");
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()["cache-control"]).toBe("private, no-store");
    const report = await allowed.json();
    expect(report.totals.providerAttempts).toBe(2);
    expect(report.totals.tokens.total).toBe(96);
    await db.query(
      `UPDATE "WorkspaceMember" SET role='member' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    await context.clearCookies();
    await useOtherSession(context);
    await page.reload();
    await expect(
      page.getByText("Operator administrator access required.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("dl")).toHaveCount(0);
    expect(
      (await context.request.get("/api/operator/provider-usage")).status(),
    ).toBe(403);
    await context.clearCookies();
    await page.reload();
    await expect(
      page.getByText("Sign in to view this report.", { exact: true }),
    ).toBeVisible();
    expect(
      (await context.request.get("/api/operator/provider-usage")).status(),
    ).toBe(401);
    expect(violations).toEqual([]);
  } finally {
    await db.query(
      `DELETE FROM "UsageCall" WHERE "callId" LIKE 'rr-e2e-usage-operator-%'`,
    );
    await db.query(
      `UPDATE "WorkspaceMember" SET role='admin' WHERE "workspaceId"=$1 AND "userId"=$2`,
      [FIXTURES.workspaces.orgAlpha, FIXTURES.users.other],
    );
    await db.end();
  }
});

type Breakdown = "models" | "runs";
function usageBreakdown(usage: Locator, kind: Breakdown): Locator {
  return usage
    .getByRole("table", {
      name: kind === "models" ? "Requested model usage" : "Review run usage",
      exact: true,
    })
    .or(
      usage.getByRole("region", {
        name:
          kind === "models" ? "Model usage summaries" : "Run usage summaries",
        exact: true,
      }),
    );
}
async function expectBreakdownCount(
  usage: Locator,
  kind: Breakdown,
  count: number,
) {
  const breakdown = usageBreakdown(usage, kind);
  await expect(breakdown).toBeVisible();
  if (await breakdown.getByRole("row").count()) {
    await expect(breakdown.getByRole("row")).toHaveCount(count + 1);
  } else {
    await expect(breakdown.getByRole("listitem")).toHaveCount(count);
  }
}
async function expectSummaryMetrics(usage: Locator, kind: Breakdown) {
  const summary = usage.getByRole("region", {
    name: kind === "models" ? "Model usage summaries" : "Run usage summaries",
    exact: true,
  });
  await expect(summary).toBeVisible();
  for (const item of await summary.getByRole("listitem").all()) {
    for (const label of ["Requests", "Known tokens", "Known cost"]) {
      const term = item
        .locator("dt")
        .filter({ hasText: new RegExp(`^${label}$`) });
      const value = term.locator("..").locator("dd");
      await expect(term).toBeVisible();
      await expect(value).toBeVisible();
      expect(
        await value.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.left >= 0 &&
            box.right <= window.innerWidth &&
            Number.parseFloat(getComputedStyle(element).fontSize) >= 12
          );
        }),
        `${kind} ${label} is readable without horizontal scrolling`,
      ).toBe(true);
    }
  }
}
async function expectCompactDashboardFooter(page: Page) {
  const footer = page.getByRole("contentinfo", {
    name: "Dashboard footer",
    exact: true,
  });
  await expect(footer).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 390)
    expect(
      await footer.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeLessThanOrEqual(140);
  await expect(footer).not.toContainText(/Product|Trust/);
  for (const link of await footer.getByRole("link").all())
    expect(
      await link.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
}

async function seedKnownCall(
  db: pg.Client,
  suffix: string,
  workspaceId: string,
  total: number,
) {
  const now = new Date().toISOString();
  const callId = `rr-e2e-usage-${suffix}`;
  const identity = {
    callId,
    workspaceId,
    repositoryId: null,
    actorId: FIXTURES.users.viewer,
    runId: callId,
    runAttempt: 1,
    invocationId: callId,
    attemptId: callId,
    bindingId: null,
    authorizationId: "rr-e2e-authorization",
    route: "direct",
    purpose: "review",
    provider: "codex",
    requestedModel: `e2e-${suffix}`,
    runtimeType: "codex",
    parentScope: null,
    granularity: "call",
    occurredAt: now,
  };
  const fact = {
    schemaVersion: 1,
    sourceInstance: "rr-e2e-runtime",
    eventId: callId,
    revision: 1,
    authority: "runtime",
    identity,
    actualProvider: "openai",
    actualModel: `e2e-${suffix}`,
    tokens: {
      inputTotal: total - 1,
      outputTotal: 1,
      total,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    cost: {
      amount: "0.01",
      currency: "USD",
      basis: "source_reported",
      source: "e2e",
      asOf: now,
      priceVersion: null,
    },
    completeness: "complete",
    state: "completed",
    dispatchEffect: "dispatched",
    durationMs: 10,
    ttftMs: null,
    correctionReason: null,
    childCallIds: null,
  };
  await db.query(
    `INSERT INTO "UsageCall" ("callId","workspaceId","actorId",provider,"actualModel",route,"runId",purpose,"occurredAt","identityHash",projection,"updatedAt") VALUES ($1,$2,$3,'codex',$4,'direct',$1,'review',$5,'synthetic',$6,CURRENT_TIMESTAMP)`,
    [
      callId,
      workspaceId,
      FIXTURES.users.viewer,
      fact.actualModel,
      now,
      JSON.stringify({ identity, usage: fact, lifecycle: null }),
    ],
  );
}

type OverviewCall = {
  suffix: string;
  day: string;
  provider: string;
  model: string | null;
  total: number | null;
  amount: string | null;
  currency?: string;
  basis?: "source_reported" | "estimated";
  route?: "gateway" | "direct";
  purpose?: "review" | "diagnostic";
  runId?: string | null;
  actorId?: string;
  observed?: string | null;
};

async function seedOverviewCall(db: pg.Client, input: OverviewCall) {
  const callId = `rr-e2e-usage-overview-${input.suffix}`;
  const occurredAt = `${input.day}T00:00:01.000Z`;
  const identity = {
    callId,
    workspaceId: FIXTURES.workspaces.orgAlpha,
    repositoryId: null,
    actorId: input.actorId ?? FIXTURES.users.viewer,
    runId:
      input.runId === undefined
        ? `rr-e2e-overview-run-${input.suffix}`
        : input.runId,
    runAttempt: 1,
    invocationId: callId,
    attemptId: callId,
    bindingId: null,
    authorizationId: "rr-e2e-authorization",
    route: input.route ?? "direct",
    purpose: input.purpose ?? "review",
    provider: input.provider,
    requestedModel: input.model,
    runtimeType: "codex",
    parentScope: null,
    granularity: "call",
    occurredAt,
  };
  const fact = {
    schemaVersion: 1,
    sourceInstance: "rr-e2e-runtime",
    eventId: callId,
    revision: 1,
    authority: "runtime",
    identity,
    actualProvider: `${input.provider}-observed`,
    actualModel: input.observed === undefined ? input.model : input.observed,
    tokens: {
      inputTotal: input.total,
      outputTotal: 0,
      total: input.total,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    cost:
      input.amount === null
        ? null
        : {
            amount: input.amount,
            currency: input.currency ?? "USD",
            basis: input.basis ?? "source_reported",
            source: "e2e",
            asOf: occurredAt,
            priceVersion: null,
          },
    completeness: input.total === null ? "unknown" : "complete",
    state: "completed",
    dispatchEffect: "dispatched",
    durationMs: 10,
    ttftMs: null,
    correctionReason: null,
    childCallIds: null,
  };
  await db.query(
    `INSERT INTO "UsageCall" ("callId","workspaceId","actorId",provider,"actualModel",route,"runId",purpose,"occurredAt","identityHash",projection,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'synthetic',$10,CURRENT_TIMESTAMP)`,
    [
      callId,
      identity.workspaceId,
      identity.actorId,
      input.provider,
      fact.actualModel,
      identity.route,
      identity.runId,
      identity.purpose,
      occurredAt,
      JSON.stringify({ identity, usage: fact, lifecycle: null }),
    ],
  );
}

function usageKpi(usage: Locator, name: string) {
  return usage
    .getByLabel("Period usage summary", { exact: true })
    .locator("dt")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator("..")
    .locator("dd");
}

async function chooseUsageOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openUsageDetails(usage: Locator) {
  const summary = usage.getByLabel("Details", { exact: true });
  if ((await summary.locator("..").getAttribute("open")) === null)
    await summary.click();
}

function expectedHumanUtc(value: string): string {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return `${day}, ${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")} UTC`;
}

async function settleCurrencyPresentation(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
