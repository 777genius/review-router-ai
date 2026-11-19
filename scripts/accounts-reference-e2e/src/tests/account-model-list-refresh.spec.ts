import { expect as baseExpect, test, type Page } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { apiKeyStorageProfiles } from "../subscription-fixture.ts";
import {
  chooseSetupOption as choose,
  openNewProvider,
} from "./provider-setup-support.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

const expect = baseExpect.configure({ timeout: 60_000 });
test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });

const workspace = FIXTURES.workspaces.personalViewer;
const nvidia = apiKeyStorageProfiles.find(
  (profile) => profile.provider === "nvidia",
)!;
// Short enough to lapse while the dialog is open or closed in this test.
const TTL_MS = 25_000;

async function fixture(
  configure?: Partial<{
    ttlMs: number;
    delayMs: number;
    status: "snapshot" | "unavailable";
  }>,
) {
  const response = await fetch(
    `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__subscription-fixture`,
    configure
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(configure),
        }
      : {},
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    nvidiaModelReads: { forceRefresh: boolean }[];
  };
}

async function openWithAccount(page: Page, name: string) {
  const dialog = await openNewProvider(page, workspace);
  await choose(page, "Provider", nvidia.label);
  await choose(page, "Account", name);
  return dialog;
}

async function expectSelectable(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Show models" }).click();
  await expect(
    page.getByRole("option", { name: nvidia.model, exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Show models" }).click();
}

// The owner's report: an NVIDIA account's model list had lapsed and every
// model sat greyed out until "Refresh models" was clicked. The list now keeps
// itself current; only a failed update asks for "Try again".
test("an NVIDIA account's model list updates itself when it lapses, with Try again only after a failure", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE !== "1",
    "Requires --api-key-storage-fixture; uses controlled Gateway HTTP, no live keys.",
  );
  test.setTimeout(300_000);
  const violations: string[] = [];
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  await fixture({ ttlMs: TTL_MS, delayMs: 0, status: "snapshot" });

  // Connect a new NVIDIA account inside the dialog; its model is offered.
  const dialog = await openNewProvider(page, workspace);
  await choose(page, "Provider", nvidia.label);
  const form = dialog.getByRole("region", { name: `Connect ${nvidia.label}` });
  const newConnection = dialog.getByRole("button", { name: "New connection" });
  await expect(form.or(newConnection)).toBeVisible();
  if (await newConnection.isVisible()) await newConnection.click();
  const name = `NVIDIA list ${Date.now()}`;
  await form.getByLabel("Connection name (optional)").fill(name);
  await form
    .locator('input[name="credential"]')
    .fill(`synthetic-${nvidia.provider}-subscription-key`);
  await form.getByRole("button", { name: "Connect account" }).click();
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toHaveValue(nvidia.model);
  const status = dialog.getByRole("status").filter({ hasText: /model list/i });
  await expect(status.first()).toHaveText(/^Model list updated just now\./);
  await page.screenshot({
    path: info.outputPath("model-list-fresh.png"),
    fullPage: true,
  });

  // Left open past the list's lifetime, the model stays selectable: the list
  // was read again before it lapsed, without a forced refresh.
  const opened = (await fixture()).nvidiaModelReads.length;
  await page.waitForTimeout(TTL_MS + 7_000);
  await expectSelectable(page);
  await expect(status.first()).toHaveText(/^Model list updated/);
  const kept = (await fixture()).nvidiaModelReads.slice(opened);
  expect(kept.length).toBeGreaterThanOrEqual(1);
  expect(kept.every((read) => !read.forceRefresh)).toBe(true);
  await dialog.getByRole("button", { name: "Close provider setup" }).click();
  await expect(dialog).toHaveCount(0);

  // Reopened after the list lapsed: it says it is updating, then offers the
  // model. Nobody clicks a refresh button.
  await fixture({ delayMs: 4_000 });
  await page.waitForTimeout(TTL_MS + 5_000);
  const beforeReopen = (await fixture()).nvidiaModelReads.length;
  await openWithAccount(page, name);
  await expect(status.first()).toHaveText(/Updating/);
  await page.screenshot({
    path: info.outputPath("model-list-expired-updating.png"),
    fullPage: true,
  });
  await expect(status.first()).toHaveText(/^Model list updated just now\./, {
    timeout: 30_000,
  });
  await expectSelectable(page);
  await page.screenshot({
    path: info.outputPath("model-list-expired-updated.png"),
    fullPage: true,
  });
  const reopened = (await fixture()).nvidiaModelReads.slice(beforeReopen);
  expect(reopened.length).toBeGreaterThanOrEqual(1);
  expect(reopened.every((read) => !read.forceRefresh)).toBe(true);
  await dialog.getByRole("button", { name: "Close provider setup" }).click();
  await expect(dialog).toHaveCount(0);

  // A failed update gives the reason and Try again, which recovers the list.
  await fixture({ delayMs: 0, status: "unavailable" });
  await page.waitForTimeout(TTL_MS + 5_000);
  await openWithAccount(page, name);
  await expect(status.first()).toHaveText(
    "The provider did not send a model list for this account.",
  );
  const retry = dialog.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  await page.screenshot({
    path: info.outputPath("model-list-failed.png"),
    fullPage: true,
  });
  await fixture({ status: "snapshot" });
  const beforeRetry = (await fixture()).nvidiaModelReads.length;
  await retry.click();
  await expect(status.first()).toHaveText(/^Model list updated just now\./);
  await expectSelectable(page);
  expect((await fixture()).nvidiaModelReads.slice(beforeRetry)).toEqual([
    { forceRefresh: true },
  ]);
  await expectNetworkViolations(violations);
});
