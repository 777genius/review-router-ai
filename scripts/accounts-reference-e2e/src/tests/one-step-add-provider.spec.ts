import { expect as baseExpect, test } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { withDatabase } from "../database.ts";
import {
  apiKeyStorageProfiles,
  subscriptionProfiles,
} from "../subscription-fixture.ts";
import {
  chooseSetupOption as choose,
  expectNoHorizontalOverflow,
  openNewProvider,
} from "./provider-setup-support.ts";
import {
  captureSecretLeaks,
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  noSecrets,
  useViewerSession,
} from "./support.ts";

const expect = baseExpect.configure({ timeout: 60_000 });
test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });

const workspace = FIXTURES.workspaces.personalViewer;
const openRouter = apiKeyStorageProfiles.find(
  (profile) => profile.provider === "openrouter",
)!;
const grok = subscriptionProfiles.find(
  (profile) => profile.provider === "grok",
)!;

async function gatewayProfiles() {
  return withDatabase(
    process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
    async (db) =>
      (
        await db.query<{
          gatewayProfileRef: string | null;
          gatewayBindingId: string | null;
          model: string;
        }>(
          `SELECT "gatewayProfileRef","gatewayBindingId",model FROM "WorkspaceProviderProfile" WHERE "workspaceId"=$1 AND "archivedAt" IS NULL AND "credentialKind"='gateway_binding' ORDER BY id`,
          [workspace],
        )
      ).rows,
  );
}

// Plan 79, stage 1: a provider with an API key is connected, given its model
// and added without leaving the Add provider dialog.
test("Add provider connects an API-key account in place and saves it with its model", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE !== "1",
    "Requires --api-key-storage-fixture; uses controlled Gateway HTTP, no live keys.",
  );
  test.setTimeout(240_000);
  const violations: string[] = [];
  const secret = `synthetic-${openRouter.provider}-subscription-key`;
  const leaks = captureSecretLeaks(page, [secret]);
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  const before = await gatewayProfiles();

  const dialog = await openNewProvider(page, workspace);
  const startUrl = page.url();
  await choose(page, "Provider", "OpenRouter");
  await expect(
    dialog.getByRole("radio", { name: /^ReviewRouter/ }),
  ).toBeChecked();
  const form = dialog.getByRole("region", { name: "Connect OpenRouter" });
  // Another spec in the same run may have left an OpenRouter connection here:
  // then the form waits behind "New connection" instead of opening itself.
  const newConnection = dialog.getByRole("button", { name: "New connection" });
  await expect(form.or(newConnection)).toBeVisible();
  if (await newConnection.isVisible()) await newConnection.click();
  await expect(form).toBeVisible();
  // The dialog chose the provider and storage: the form repeats neither.
  await expect(form.getByRole("combobox", { name: /Provider/ })).toHaveCount(0);
  await expect(form.getByRole("radio", { name: /GitHub/ })).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Connect account" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("one-step-connect-form-desktop.png"),
    fullPage: true,
  });

  const name = `One step ${Date.now()}`;
  await form.getByLabel("Connection name", { exact: true }).fill(name);
  await form.getByLabel("API key", { exact: true }).fill(secret);
  await form
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();

  await expect(
    dialog.getByText("Connected and added to this workspace."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: /^Account\b/ }),
  ).toContainText(name);
  await expect(form).toHaveCount(0);
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toHaveValue(openRouter.model);
  // The whole flow stayed in one dialog on one page, and the key left no trace.
  expect(page.url()).toBe(startUrl);
  await noSecrets(page, [secret]);
  await page.screenshot({
    path: info.outputPath("one-step-connected-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: info.outputPath("one-step-connected-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await dialog
    .getByRole("button", { name: /^Add (and make default|provider)$/ })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: /^(Workspace default|Provider) saved$/,
    }),
  ).toBeVisible();
  const added = (await gatewayProfiles()).filter(
    (row) =>
      !before.some(
        (old) =>
          old.gatewayBindingId === row.gatewayBindingId &&
          old.model === row.model,
      ),
  );
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({
    gatewayProfileRef: openRouter.profileId,
    model: openRouter.model,
  });
  expect(added[0]!.gatewayBindingId).toBeTruthy();
  await leaks.verify();
  await expectNetworkViolations(violations);
});

// Plan 79, stage 2: an OAuth provider signs in from the same dialog. Grok's
// browser sign-in opens its tab and the authorization code is entered here.
test("Add provider signs in to Grok in place and selects the new account", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_SUBSCRIPTIONS !== "1",
    "Requires --subscription-fixture; controlled Gateway HTTP, no live OAuth.",
  );
  test.setTimeout(240_000);
  const violations: string[] = [];
  const authorizationCode = "synthetic-browser-grok-code";
  const leaks = captureSecretLeaks(page, [authorizationCode]);
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  const before = await gatewayProfiles();
  // The SDK validates the fixed provider origin; serve one synthetic page
  // in the browser instead of reaching xAI.
  await context.route("https://auth.x.ai/oauth2/authorize?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Synthetic authorization</title><code>${authorizationCode}</code>`,
    }),
  );

  const dialog = await openNewProvider(page, workspace);
  const startUrl = page.url();
  await choose(page, "Provider", "Grok");
  const form = dialog.getByRole("region", { name: "Connect Grok" });
  const newConnection = dialog.getByRole("button", { name: "New connection" });
  await expect(form.or(newConnection)).toBeVisible();
  if (await newConnection.isVisible()) await newConnection.click();
  await expect(form).toBeVisible();
  await form.getByLabel("Connection name").fill(`One step Grok ${Date.now()}`);
  const popup = page.waitForEvent("popup");
  await form.getByRole("button", { name: "Connect Grok", exact: true }).click();
  const authorization = await popup;
  const code = await authorization.locator("code").innerText();
  await authorization.close();
  // The request holds the provider choice while it waits for the code.
  await expect(
    dialog.getByRole("combobox", { name: "Provider", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("one-step-grok-code-desktop.png"),
    fullPage: true,
  });
  await form.getByLabel("Authorization code", { exact: true }).fill(code);
  await form.getByRole("button", { name: "Complete authorization" }).click();

  await expect(
    dialog.getByText("Connected and added to this workspace."),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue(grok.model);
  expect(page.url()).toBe(startUrl);
  await noSecrets(page, [authorizationCode]);
  await page.screenshot({
    path: info.outputPath("one-step-grok-connected-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: info.outputPath("one-step-grok-connected-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await dialog
    .getByRole("button", { name: /^Add (and make default|provider)$/ })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: /^(Workspace default|Provider) saved$/,
    }),
  ).toBeVisible();
  const added = (await gatewayProfiles()).filter(
    (row) =>
      !before.some(
        (old) =>
          old.gatewayBindingId === row.gatewayBindingId &&
          old.model === row.model,
      ),
  );
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({
    gatewayProfileRef: grok.profileId,
    model: grok.model,
  });
  await leaks.verify();
  await expectNetworkViolations(violations);
});

test("Add provider resets unsubmitted credentials when switching providers and preserves existing Codex without enrollment", async ({
  page,
  context,
  request,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE !== "1" ||
      process.env.ACCOUNTS_REFERENCE_E2E_ACCOUNT_MODELS !== "1",
    "Requires API-key storage and account-model fixtures; no live credentials.",
  );
  test.setTimeout(240_000);
  const violations: string[] = [];
  const secret = "synthetic-unsent-one-step-key";
  const leaks = captureSecretLeaks(page, [secret]);
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  const statsUrl = `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__subscription-fixture`;
  const before = await (await request.get(statsUrl)).json();

  const dialog = await openNewProvider(page, FIXTURES.workspaces.orgAlpha);
  const startUrl = page.url();
  // The account-model fixture deliberately advertises create:false for Codex.
  // Its existing authorized account remains selectable without a new sign-in.
  await choose(page, "Provider", "Codex");
  await choose(page, "Account", FIXTURES.sourceLabels.viewerPrimary);
  await expect(
    dialog.getByRole("combobox", { name: /^Account\b/ }),
  ).toContainText(FIXTURES.sourceLabels.viewerPrimary);
  await expect(
    dialog.getByRole("region", { name: "Connect Codex", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "New connection", exact: true }),
  ).toHaveCount(0);

  // Neither of these profiles has an account here, so the same embedded host
  // stays mounted across the provider change. Each provider needs a fresh form.
  await choose(page, "Provider", "Kimi Code");
  const kimiForm = dialog.getByRole("region", {
    name: "Connect Kimi Code",
    exact: true,
  });
  const kimiKey = kimiForm.getByLabel("API key", { exact: true });
  await expect(kimiKey).toBeVisible();
  await kimiKey.fill(secret);
  await choose(page, "Provider", "MiMo Token Plan");
  const mimoKey = dialog
    .getByRole("region", { name: "Connect MiMo Token Plan", exact: true })
    .getByLabel("API key", { exact: true });
  await expect(mimoKey).toBeVisible();
  await expect(mimoKey).toHaveValue("");
  await expect(kimiForm).toHaveCount(0);
  await choose(page, "Provider", "Kimi Code");
  await expect(kimiKey).toBeVisible();
  await expect(kimiKey).toHaveValue("");
  await noSecrets(page, [secret]);
  await page.screenshot({
    path: info.outputPath("one-step-provider-switch-cleared.png"),
    fullPage: true,
  });

  await choose(page, "Provider", "Codex");
  await choose(page, "Account", FIXTURES.sourceLabels.viewerPrimary);
  await expect(
    dialog.getByRole("combobox", { name: /^Account\b/ }),
  ).toContainText(FIXTURES.sourceLabels.viewerPrimary);
  await expect(
    dialog.getByRole("region", { name: "Connect Codex", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "New connection", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator('input[name="credential"]')).toHaveCount(0);
  expect(page.url()).toBe(startUrl);
  const after = await (await request.get(statsUrl)).json();
  for (const field of [
    "connects",
    "begins",
    "completes",
    "reconnects",
    "deletes",
    "operationIds",
  ])
    expect(after[field]).toEqual(before[field]);
  await noSecrets(page, [secret]);
  await leaks.verify();
  await expectNetworkViolations(violations);
});
