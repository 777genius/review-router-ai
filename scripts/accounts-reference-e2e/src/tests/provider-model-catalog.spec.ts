import { expect, test } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import {
  chooseSetupOption,
  openNewProvider,
} from "./provider-setup-support.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_CATALOG !== "1",
  "Requires the opt-in --catalog-fixture harness.",
);
test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });

test("public catalogs refresh direct providers, preserve the selected ID, and never test a connection automatically", async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await useViewerSession(context);
  const connectionTests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/accounts/test"))
      connectionTests.push(request.url());
  });
  const dialog = await openNewProvider(page, FIXTURES.workspaces.orgAlpha);
  await chooseSetupOption(page, "Provider", "OpenRouter");
  await dialog.getByRole("radio", { name: /^GitHub Secrets\b/u }).check();
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await model.fill("openrouter-saved-model");
  await model.press("Escape");
  await expect(dialog).toBeVisible();

  // Exercise the actual public API, server normalization and cache before
  // supplying the narrow browser-only stale/cooldown response below.
  const response = page.waitForResponse((result) => {
    const url = new URL(result.url());
    return (
      url.pathname === "/api/provider-model-catalog" &&
      url.searchParams.get("providerKind") === "openrouter" &&
      url.searchParams.get("refresh") === "true"
    );
  });
  await dialog
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  const refreshed = await response;
  expect(refreshed.ok()).toBe(true);
  expect((await refreshed.json()).models).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "vendor/fixture" })]),
  );
  await expect(model).toHaveValue("openrouter-saved-model");

  const refreshes: string[] = [];
  await page.route("**/api/provider-model-catalog?*", (route) => {
    const kind = new URL(route.request().url()).searchParams.get(
      "providerKind",
    )!;
    refreshes.push(kind);
    return route.fulfill({
      json: {
        providerKind: kind,
        models: [
          {
            id: `${kind}-e2e-public`,
            name: `${kind} E2E public`,
            contextTokens: 10000,
            textInput: true,
            textOutput: true,
            toolCalling: true,
            pricing: null,
          },
        ],
        source: kind === "openrouter" ? "openrouter" : "models.dev",
        fetchedAt: Date.now() - 60_000,
        lastAttemptAt: Date.now(),
        state: "stale",
        error: "source_unavailable",
        refresh: "cooldown",
      },
    });
  });
  // These are the direct public catalogs offered by the workspace dialog.
  // Repository-scoped rotating Codex is not a workspace credential source.
  for (const [kind, label] of [
    ["openrouter", "OpenRouter"],
    ["claude", "Claude Code"],
  ] as const) {
    await chooseSetupOption(page, "Provider", label);
    await dialog.getByRole("radio", { name: /^GitHub Secrets\b/u }).check();
    await model.fill(`${kind}-saved-model`);
    await model.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Refresh models", exact: true })
      .click();
    await expect.poll(() => refreshes.includes(kind)).toBe(true);
    await expect(model).toHaveValue(`${kind}-saved-model`);
    await expect(
      dialog.getByText("Not in the list; this name is used as typed."),
    ).toBeVisible();
    await expect(
      dialog.getByText("Access to these models has not been checked."),
    ).toBeVisible();
    await expect(
      dialog
        .getByRole("status")
        .filter({ hasText: "Please wait before refreshing again." }),
    ).toBeVisible();
    await model.fill("");
    await model.focus();
    await page
      .getByRole("option")
      .filter({ hasText: `${kind} E2E public` })
      .click();
    await expect(model).toHaveValue(`${kind}-e2e-public`);
  }
  await info.attach("public-catalog-selection", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await dialog.getByRole("button", { name: "Close provider setup" }).click();
  await expect(dialog).toHaveCount(0);
  expect(connectionTests).toEqual([]);
  expect(violations).toEqual([]);
});

test("public catalogs Gateway allowlist is account-scoped and keeps an explicit connection probe", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_PROBE !== "1",
    "Requires --probe-fixture; independent public catalog scenario still runs.",
  );
  test.setTimeout(180_000);
  const violations: string[] = [];
  const connectionTests: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await useViewerSession(context);
  page.on("request", (request) => {
    if (request.url().includes("/accounts/test"))
      connectionTests.push(request.url());
  });
  const dialog = await openNewProvider(page, FIXTURES.workspaces.orgAlpha);
  await chooseSetupOption(page, "Provider", "MiMo Token Plan");
  await dialog.getByRole("radio", { name: /^ReviewRouter/ }).check();
  await expect(
    dialog.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveCount(0);
  await chooseSetupOption(page, "Account", FIXTURES.sourceLabels.orgAlpha);
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toHaveValue("rr-e2e-model");
  await model.click();
  await expect(
    page.getByRole("option", { name: "rr-e2e-model", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("option").filter({ hasText: "vendor/fixture" }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "rr-e2e-model", exact: true }).click();
  await expect(model).toHaveValue("rr-e2e-model");
  await expect(
    dialog.getByRole("status").filter({
      hasText:
        "Models from the connected profile. Account-specific discovery is not offered.",
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Refresh models", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Test connection", exact: true }),
  ).toBeEnabled();
  await info.attach("authorized-gateway-selection", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(connectionTests).toEqual([]);
  expect(violations).toEqual([]);
});
