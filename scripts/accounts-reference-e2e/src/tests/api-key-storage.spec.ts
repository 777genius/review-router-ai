import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { withDatabase } from "../database.ts";
import { apiKeyStorageProfiles } from "../subscription-fixture.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  sourceRow,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE !== "1",
  "Requires --api-key-storage-fixture; uses controlled Gateway HTTP, no live keys.",
);
const expect = baseExpect.configure({ timeout: 60_000 });
test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });

const workspace = FIXTURES.workspaces.personalViewer;
const providers = [
  {
    id: "openrouter",
    label: "OpenRouter",
    authMode: "openrouter_api_key",
    model: "openai/gpt-5.4-mini",
  },
  {
    id: "mimo",
    label: "MiMo Token Plan",
    authMode: "mimo_token_plan_api_key",
    model: "mimo-v2.6-pro",
  },
  {
    id: "kimi",
    label: "Kimi Code",
    authMode: "kimi_code_api_key",
    model: "k3-256k",
  },
] as const;

type Profile = {
  id: string;
  label: string;
  authMode: string;
  credentialKind: string;
  gatewayBindingId: string | null;
  gatewayProfileRef: string | null;
  apiKeyConnectionId: string | null;
  model: string;
};

async function savedProfiles(): Promise<Profile[]> {
  return withDatabase(
    process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
    async (db) =>
      (
        await db.query<Profile>(
          `SELECT id,label,"authMode","credentialKind","gatewayBindingId","gatewayProfileRef","apiKeyConnectionId",model FROM "WorkspaceProviderProfile" WHERE "workspaceId"=$1 AND "archivedAt" IS NULL ORDER BY id`,
          [workspace],
        )
      ).rows,
  );
}

async function choose(page: Page, label: string, value: string) {
  const control = page
    .getByRole("dialog")
    .getByRole("combobox", { name: label, exact: true });
  // First request compiles the real Next route and reads its authorized view.
  await expect(control).toBeVisible({ timeout: 60_000 });
  await control.click();
  await page.getByRole("option").filter({ hasText: value }).click();
}

async function beginProvider(page: Page, label: string) {
  await page.goto(`/dashboard?section=providers&workspace=${workspace}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
  // Opening is reversible. Retry only an event that preceded streamed hydration
  // or a development full reload; no save/enrollment operation is retried here.
  await expect(async () => {
    if (!(await page.getByRole("dialog").isVisible()))
      await page
        .getByRole("button", { name: "Add provider", exact: true })
        .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: "Provider", exact: true }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await choose(page, "Provider", label);
  return page.getByRole("dialog");
}

async function accountsReady(
  page: Page,
  navigate: () => Promise<unknown>,
): Promise<void> {
  // Existing Accounts reference hydration witness; keep the continuation URL.
  const hydrated = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/dashboard/accounts/access" &&
        url.searchParams.get("view") === "summaries" &&
        response.request().method() === "GET"
      );
    },
    { timeout: 60_000 },
  );
  await navigate();
  await expect(
    page.getByRole("region", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
  await hydrated;
}

async function expectStorage(dialog: Locator) {
  const choice = dialog.getByRole("radiogroup", { name: "Key storage" });
  await expect(choice.getByRole("radio")).toHaveCount(2);
  await expect(choice).toContainText(
    "Add the key to each repository on GitHub.",
  );
  await expect(choice).toContainText(
    "Store the key encrypted and reuse it across repositories.",
  );
  return choice;
}

async function noSecrets(page: Page, secrets: readonly string[]) {
  const retained = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      location: location.href,
      markup: document.body.innerHTML,
      inputValues: Array.from(
        document.querySelectorAll("input"),
        (input) => input.value,
      ),
    }),
  );
  for (const secret of secrets) expect(retained).not.toContain(secret);
}

async function createWithoutDefault(page: Page, before: readonly Profile[]) {
  const dialog = page.getByRole("dialog");
  const useDefault = dialog.getByRole("checkbox", {
    name: /Use as workspace default/,
  });
  if (await useDefault.isChecked()) await useDefault.uncheck();
  await dialog
    .getByRole("button", { name: "Add provider", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  const added = (await savedProfiles()).filter(
    (row) => !before.some((old) => old.id === row.id),
  );
  expect(added).toHaveLength(1);
  return added[0]!;
}

test("API key storage creates all three GitHub profiles and preserves identity when changing storage", async ({
  page,
  context,
}, info) => {
  test.setTimeout(480_000);
  const violations: string[] = [];
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  await page.addInitScript(() =>
    localStorage.setItem("reviewrouter-theme", "dark"),
  );
  const created: Profile[] = [];
  for (const provider of providers) {
    const before = await savedProfiles();
    const dialog = await beginProvider(page, provider.label);
    const storage = await expectStorage(dialog);
    await storage.getByRole("radio", { name: /^GitHub Secrets/ }).check();
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: /^Account\b/ }),
    ).toHaveCount(0);
    await dialog.getByLabel("Model", { exact: true }).fill(provider.model);
    await dialog
      .getByRole("checkbox", { name: /Use as workspace default/ })
      .focus();
    await expect(dialog.getByRole("listbox")).toHaveCount(0);
    if (provider.id === "kimi") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(
        dialog.getByRole("combobox", { name: "Review depth", exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("checkbox", { name: /Fast mode/ }),
      ).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: info.outputPath("key-storage-desktop-dark.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath("key-storage-mobile-dark.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const added = await createWithoutDefault(page, before);
    expect(added).toMatchObject({
      credentialKind: "user_ci_secret",
      authMode: provider.authMode,
      model: provider.model,
      gatewayBindingId: null,
      gatewayProfileRef: null,
      apiKeyConnectionId: null,
    });
    created.push(added);
  }
  const original = created[2]!;
  const row = page
    .getByText(original.label, { exact: true })
    .locator("xpath=ancestor::li");
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Key storage: GitHub Secrets",
  );
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Add with different storage", exact: true })
    .click();
  const replacement = page.getByRole("dialog");
  await expect(
    replacement.getByRole("combobox", { name: "Provider", exact: true }),
  ).toContainText("Kimi Code");
  await expect(
    (await expectStorage(replacement)).getByRole("radio", {
      name: /^ReviewRouter/,
    }),
  ).toBeChecked();
  await expect(
    replacement.getByRole("link", { name: "Connect account", exact: true }),
  ).toBeVisible();
  expect(
    (await savedProfiles()).find((profile) => profile.id === original.id),
  ).toEqual(original);
  expect(await savedProfiles()).toHaveLength(created.length);
  await expectNetworkViolations(violations);
});

test("API key storage connects all three accounts and returns to the same provider setup", async ({
  page,
  context,
  request,
}, info) => {
  test.setTimeout(480_000);
  const violations: string[] = [];
  const secrets: string[] = [];
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  await page.addInitScript(() =>
    localStorage.setItem("reviewrouter-theme", "light"),
  );
  for (const provider of providers) {
    const profile = apiKeyStorageProfiles.find(
      (row) => row.provider === provider.id,
    )!;
    const before = await savedProfiles();
    const dialog = await beginProvider(page, provider.label);
    await (await expectStorage(dialog))
      .getByRole("radio", { name: /^ReviewRouter/ })
      .check();
    const connect = dialog.getByRole("link", {
      name: "Connect account",
      exact: true,
    });
    const accountsHref = await connect.getAttribute("href");
    expect(accountsHref).toContain(`workspace=${workspace}`);
    expect(accountsHref).toContain(`keyProvider=${provider.id}`);
    await accountsReady(page, () => connect.click());
    await page
      .getByRole("button", { name: "Connect account", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Connect with API key", exact: true })
      .click();
    const enrollment = page.getByRole("dialog");
    await expect(
      enrollment.getByRole("combobox", {
        name: "Provider profile",
        exact: true,
      }),
    ).toContainText(profile.label);
    const choice = await expectStorage(enrollment);
    if (provider.id === "openrouter") {
      const erased = "synthetic-unsent-storage-switch-key";
      await enrollment.locator('input[type="password"]').fill(erased);
      await choice.getByRole("radio", { name: /^GitHub Secrets/ }).check();
      await expect(enrollment.locator('input[type="password"]')).toHaveCount(0);
      await noSecrets(page, [erased]);
      await enrollment
        .getByRole("link", { name: "Continue to provider setup", exact: true })
        .click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("radio", { name: /^GitHub Secrets/ }),
      ).toBeChecked();
      expect(await savedProfiles()).toEqual(before);
      await accountsReady(page, () => page.goto(accountsHref!));
      await page
        .getByRole("button", { name: "Connect account", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Connect with API key", exact: true })
        .click();
      await expect(
        enrollment.getByRole("combobox", {
          name: "Provider profile",
          exact: true,
        }),
      ).toContainText(profile.label);
    }
    await enrollment.getByRole("radio", { name: /^ReviewRouter/ }).check();
    const runLabel =
      process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON?.split("/").at(-2) ??
      "fixture";
    const name = `Storage E2E ${provider.label} ${runLabel}`;
    await enrollment.getByLabel("Connection name (optional)").fill(name);
    const secret = `synthetic-${provider.id}-subscription-key`;
    secrets.push(secret);
    await enrollment.locator('input[type="password"]').fill(secret);
    await enrollment.locator('input[type="password"]').press("Enter");
    await expect(sourceRow(page, name)).toBeVisible();
    await noSecrets(page, secrets);
    const back = page.getByRole("link", {
      name: "Back to provider setup",
      exact: true,
    });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute(
      "href",
      new RegExp(`keyProvider=${provider.id}`),
    );
    await back.click();
    const returned = page.getByRole("dialog");
    await expect(
      returned.getByRole("combobox", { name: "Provider", exact: true }),
    ).toContainText(provider.label);
    await expect(
      returned.getByRole("radio", { name: /^ReviewRouter/ }),
    ).toBeChecked();
    await choose(page, "Account", name);
    await expect(
      returned.getByRole("combobox", { name: "Model", exact: true }),
    ).toContainText(profile.model);
    if (provider.id === "kimi") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: info.outputPath("key-storage-desktop-light.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath("key-storage-mobile-light.png"),
        fullPage: true,
      });
    }
    const added = await createWithoutDefault(page, before);
    expect(added).toMatchObject({
      credentialKind: "gateway_binding",
      authMode: "codex_account_gateway",
      gatewayProfileRef: profile.profileId,
      apiKeyConnectionId: null,
      model: profile.model,
    });
    expect(added.gatewayBindingId).toBeTruthy();
    for (const original of before)
      expect(
        (await savedProfiles()).find((row) => row.id === original.id),
      ).toEqual(original);
  }
  const stats = await (
    await request.get(
      `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__subscription-fixture`,
    )
  ).json();
  expect(stats).toMatchObject({ connects: 3, inference: 0, refresh: 0 });
  await expectNetworkViolations(violations);
});
