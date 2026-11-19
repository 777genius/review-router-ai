import { expect as baseExpect, test } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { withDatabase } from "../database.ts";
import { apiKeyStorageProfiles } from "../subscription-fixture.ts";
import {
  chooseSetupOption as choose,
  expectNoHorizontalOverflow,
  openNewProvider,
} from "./provider-setup-support.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE !== "1",
  "Requires --api-key-storage-fixture; uses controlled Gateway HTTP, no live keys.",
);
const expect = baseExpect.configure({ timeout: 60_000 });
test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });

const workspace = FIXTURES.workspaces.personalViewer;
const openRouter = apiKeyStorageProfiles.find(
  (profile) => profile.provider === "openrouter",
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
  test.setTimeout(240_000);
  const violations: string[] = [];
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
  await form.getByLabel("Connection name (optional)").fill(name);
  await form
    .locator('input[name="credential"]')
    .fill(`synthetic-${openRouter.provider}-subscription-key`);
  await form.getByRole("button", { name: "Connect account" }).click();

  await expect(
    dialog.getByText("Connected and added to this workspace."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: /^Account\b/ }),
  ).toContainText(name);
  await expect(form).toHaveCount(0);
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toHaveValue(openRouter.model);
  // The whole flow stayed in one dialog on one page.
  expect(page.url()).toBe(startUrl);
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
  await expectNetworkViolations(violations);
});
