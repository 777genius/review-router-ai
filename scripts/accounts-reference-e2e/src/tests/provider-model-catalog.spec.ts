import { expect, test, type Page } from "@playwright/test";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

async function choose(page: Page, label: string, choice: string, row = 0) {
  const trigger = page
    .getByRole("combobox", { name: label, exact: true })
    .nth(row);
  const option = page.getByRole("option").filter({ hasText: choice });
  // A server-rendered trigger can precede hydration. Retry opening the real
  // interactive control, while waiting for the actual authorized options.
  await expect(async () => {
    if (!(await page.getByRole("listbox").count())) await trigger.click();
    await expect(option).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  await option.click();
}

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_CATALOG !== "1",
  "Requires the opt-in --catalog-fixture harness.",
);

test("public catalogs refresh all vendors, preserve the selected ID, and never test a connection automatically", async ({
  page,
  context,
}, info) => {
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await useViewerSession(context);
  const refreshes: string[] = [];
  const connectionTests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/accounts/test"))
      connectionTests.push(request.url());
  });
  await page.route("**/api/provider-model-catalog?*", (route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get("providerKind")!;
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
  await page.goto("/dashboard?section=policy&workspace=rr-e2e-org-alpha");
  for (const [kind, label] of [
    ["codex", "OpenAI / Codex"],
    ["claude", "Anthropic / Claude"],
    ["openrouter", "OpenRouter"],
  ] as const) {
    await choose(page, "Provider", label);
    await choose(page, "Connection method", "GitHub Secrets");
    const model = page
      .getByRole("textbox", { name: "Model", exact: true })
      .first();
    await model.fill(`${kind}-saved-model`);
    await page
      .getByRole("button", { name: "Refresh models", exact: true })
      .first()
      .click();
    await expect.poll(() => refreshes.includes(kind)).toBe(true);
    await expect(model).toHaveValue(`${kind}-saved-model`);
    await expect(
      page.getByText("Current model; not in the current catalog.").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Account access not checked.").first(),
    ).toBeVisible();
    await expect(page.getByText(/refresh cooldown/).first()).toBeVisible();
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
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Provider", exact: true }),
  ).toHaveCount(2);
  await choose(page, "Provider", "Anthropic / Claude", 1);
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Provider", exact: true }),
  ).toContainText("Anthropic / Claude");
  expect(connectionTests).toEqual([]);
  expect(violations).toEqual([]);
});

test("public catalogs Gateway allowlist retains an authorized model and a usable explicit connection probe", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_PROBE !== "1",
    "Requires --probe-fixture; independent public catalog scenario still runs.",
  );
  const violations: string[] = [];
  const connectionTests: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await useViewerSession(context);
  page.on("request", (request) => {
    if (request.url().includes("/accounts/test"))
      connectionTests.push(request.url());
  });
  await page.goto("/dashboard?section=policy&workspace=rr-e2e-org-alpha");
  await choose(page, "Provider", "MiMo");
  await choose(page, "Connection method", "ReviewRouter / sub2api (encrypted)");
  await choose(page, "Account", "RR E2E Org Alpha Owned");
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await expect(
    page
      .getByRole("option")
      .filter({ hasText: "Not allowed by the selected Gateway profile." })
      .first(),
  ).toBeDisabled();
  await page.getByRole("option", { name: "rr-e2e-model", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toContainText("rr-e2e-model");
  await info.attach("authorized-gateway-selection", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await expect(
    page.getByRole("button", { name: "Test connection", exact: true }),
  ).toBeEnabled();

  expect(connectionTests).toEqual([]);
  expect(violations).toEqual([]);
});
