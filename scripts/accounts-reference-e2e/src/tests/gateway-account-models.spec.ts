import { expect, test, type Page } from "@playwright/test";
import { withDatabase } from "../database.ts";
import { FIXTURES } from "../contracts.ts";
import {
  CODEX_A_MODEL,
  CODEX_A_REFRESHED,
  CODEX_B_MODEL,
  CODEX_SAVED_PROFILE,
} from "../account-models-fixture.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_ACCOUNT_MODELS !== "1",
  "Requires --account-models-fixture.",
);

async function fixture(phase?: string) {
  const response = await fetch(
    `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__account-models-fixture`,
    phase
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phase }),
        }
      : {},
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    phase: string;
    reads: { accountRef: string; forceRefresh: boolean }[];
  };
}
async function choose(page: Page, label: string, value: string) {
  const control = page.getByRole("dialog").getByRole("combobox", {
    name: label === "Account" ? /^Account\b/ : label,
    exact: true,
  });
  await expect(async () => {
    if (!(await page.getByRole("listbox").count())) await control.click();
    await expect(
      page.getByRole("option").filter({ hasText: value }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  await page.getByRole("option").filter({ hasText: value }).click();
}
async function profiles() {
  return withDatabase(
    process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
    async (db) => {
      const value = await db.query<{
        id: string;
        model: string;
        label: string;
        gatewayBindingId: string;
      }>(
        `SELECT id,model,label,"gatewayBindingId" FROM "WorkspaceProviderProfile" WHERE "workspaceId"=$1 AND "archivedAt" IS NULL`,
        [FIXTURES.workspaces.orgAlpha],
      );
      return value.rows;
    },
  );
}

test("dynamic Codex account models work in provider edit and add with exact binding refresh and save validation", async ({
  page,
  context,
}, info) => {
  const violations: string[] = [];
  await installLoopbackOnlyNetworkGuard(page, violations);
  await useViewerSession(context);
  await fixture("initial");
  const original = (await profiles()).find(
    (profile) => profile.id === CODEX_SAVED_PROFILE,
  );
  expect(original).toBeDefined();
  const savedModel = original!.model;
  await page.goto("/dashboard?section=providers&workspace=rr-e2e-org-alpha");
  const row = page
    .getByText(original!.label, { exact: true })
    .locator("xpath=ancestor::li");
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText(savedModel);
  await expect(dialog.getByRole("status")).toContainText(
    "Codex account models",
  );
  await expect(model).toContainText(savedModel);
  await choose(page, "Model", CODEX_A_MODEL);
  // The same model is now offered only by account B; A must reject the stale
  // selection at the real server action before changing the profile row.
  await fixture("foreign-only");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(
    (await profiles()).find((profile) => profile.id === CODEX_SAVED_PROFILE)
      ?.model,
  ).toBe(savedModel);
  const before = await fixture("initial");
  await dialog
    .getByRole("button", { name: "Refresh models", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Codex account models",
  );
  await expect(model).toContainText(CODEX_A_MODEL);
  await choose(page, "Model", CODEX_A_REFRESHED);
  const after = await fixture();
  const forceReads = after.reads
    .slice(before.reads.length)
    .filter((read) => read.forceRefresh);
  expect(forceReads).toEqual([
    { accountRef: FIXTURES.gateway.accounts.viewerPrimary, forceRefresh: true },
  ]);
  expect(
    after.reads.some(
      (read) => read.accountRef === FIXTURES.gateway.accounts.orgAlpha,
    ),
  ).toBe(false);
  const updatedLabel =
    original!.label === "Codex saved" ? "Codex selected" : "Codex saved";
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(updatedLabel);
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await profiles()).find((profile) => profile.id === CODEX_SAVED_PROFILE),
  ).toMatchObject({
    model: CODEX_A_REFRESHED,
    label: updatedLabel,
    gatewayBindingId: FIXTURES.bindings.viewerAlpha,
  });

  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(dialog).toBeVisible();
  await choose(page, "Where the credential comes from", "Connected account");
  await choose(page, "Account", FIXTURES.sourceLabels.orgAlpha);
  const useDefault = dialog.getByRole("checkbox", {
    name: /Use as workspace default/,
  });
  if (await useDefault.isChecked()) await useDefault.uncheck();
  await choose(page, "Model", CODEX_B_MODEL);
  await expect(dialog.getByRole("status")).toContainText(
    "Codex account models",
  );
  await dialog
    .getByRole("button", { name: "Add provider", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await profiles()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        model: CODEX_B_MODEL,
        gatewayBindingId: FIXTURES.bindings.orgAlpha,
      }),
    ]),
  );
  await info.attach("dynamic-account-models", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(violations).toEqual([]);
});
