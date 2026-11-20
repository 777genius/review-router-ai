import { expect as baseExpect, test } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
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

const expect = baseExpect.configure({ timeout: 60_000 });
test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });

const workspace = FIXTURES.workspaces.personalViewer;
const openRouter = apiKeyStorageProfiles.find(
  (profile) => profile.provider === "openrouter",
)!;

// A workspace whose only default reviewer is an OpenRouter :free model stops
// reviewing once the model's daily limit is used up. The roster says so once
// and offers its own Add reviewer; nothing is saved here.
test("Daily limit notice advises a second reviewer for a sole free OpenRouter model", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_API_KEY_STORAGE !== "1",
    "Requires --api-key-storage-fixture; uses controlled Gateway HTTP, no live keys.",
  );
  test.setTimeout(240_000);
  expect(openRouter.model.endsWith(":free")).toBe(true);
  const violations: string[] = [];
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);

  const dialog = await openNewProvider(page, workspace);
  await choose(page, "Provider", "OpenRouter");
  const form = dialog.getByRole("region", { name: "Connect OpenRouter" });
  const newConnection = dialog.getByRole("button", { name: "New connection" });
  await expect(form.or(newConnection)).toBeVisible();
  if (await newConnection.isVisible()) await newConnection.click();
  await form
    .getByLabel("Connection name (optional)")
    .fill(`Free model ${Date.now()}`);
  // The only key the controlled Gateway enrolls for this provider.
  await form
    .locator('input[name="credential"]')
    .fill(`synthetic-${openRouter.provider}-subscription-key`);
  await form.getByRole("button", { name: "Connect account" }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue(openRouter.model);
  // The workspace default becomes this one reviewer.
  await dialog
    .getByRole("checkbox", { name: /Use as workspace default/ })
    .check();
  await dialog
    .getByRole("button", { name: "Add and make default", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Workspace default saved" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const defaults = page
    .getByRole("region", { name: "Workspace providers" })
    .getByRole("listitem")
    .filter({ has: page.getByText("Default", { exact: true }) });
  await expect(defaults).toHaveCount(1);
  await defaults.getByRole("button", { name: "Review settings" }).click();
  const notice = dialog.getByRole("note");
  await expect(notice).toContainText(
    "This model has a daily request limit. When it is used up, reviews stop",
  );
  await expect(
    dialog.getByText(/^1\. /).filter({ hasText: openRouter.model }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save reviewers" }),
  ).toBeEnabled();
  await notice.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("daily-limit-notice-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await notice.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: info.outputPath("daily-limit-notice-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await notice
    .getByRole("button", { name: "Add a second reviewer", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Account for reviewer 2" }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: /How reviewers work together/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("daily-limit-notice-second-reviewer.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close provider setup" }).click();
  await expect(dialog).toHaveCount(0);
  await expectNetworkViolations(violations);
});
