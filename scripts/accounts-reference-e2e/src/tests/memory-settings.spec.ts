import { expect, test, type Page } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { expectNoHorizontalOverflow } from "./provider-setup-support.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_REVIEW_RUNTIME !== "1",
  "Requires the existing --review-runtime-fixture disposable workspace and repositories.",
);

async function openMemorySettings(
  page: Page,
  repositoryId?: string,
): Promise<void> {
  const workspace = FIXTURES.workspaces.personalViewer;
  await page.goto(
    `/dashboard?section=memory&workspace=${workspace}${repositoryId ? `&memoryRepository=${repositoryId}` : ""}`,
    { waitUntil: "domcontentloaded", timeout: 120_000 },
  );
  await expect(
    page.getByRole("heading", { name: "Memory", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
}

async function saveMemorySettings(page: Page): Promise<void> {
  const versionInput = page
    .getByRole("region", { name: "Settings", exact: true })
    .locator('input[name="expectedVersion"]');
  const previousVersion = await versionInput.inputValue();
  expect(previousVersion).toMatch(/^[1-9]\d*$/);
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().headers()["next-action"] !== undefined,
      { timeout: 30_000 },
    ),
    page
      .getByRole("button", { name: "Save memory settings", exact: true })
      .click(),
  ]);
  expect(response.ok()).toBe(true);
  // The success notice precedes router.refresh(). Wait for the updated
  // server-rendered policy version before starting another navigation.
  await expect(
    page.getByText("Memory settings saved", { exact: true }),
  ).toBeVisible();
  await expect(versionInput).toHaveValue(String(Number(previousVersion) + 1));
}

test.afterEach(async ({ context }, info) => {
  if (info.status === info.expectedStatus) return;
  // Use a separate page so teardown keeps the failed page and its evidence.
  const cleanupPage = await context.newPage();
  const violations: string[] = [];
  try {
    await installLoopbackOnlyNetworkGuard(cleanupPage, violations);
    await openMemorySettings(cleanupPage);
    const checkbox = cleanupPage.getByRole("checkbox", {
      name: /Require confirmation for memory changes/,
    });
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
      await saveMemorySettings(cleanupPage);
      await openMemorySettings(cleanupPage);
    }
    await expect(checkbox).not.toBeChecked();
    expectNetworkViolations(violations);
  } finally {
    await cleanupPage.close();
  }
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
])
  test(`${viewport.name}: Memory confirmation settings persist across repository selections`, async ({
    page,
    context,
  }, info) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.setViewportSize(viewport);
    const open = (repositoryId?: string) =>
      openMemorySettings(page, repositoryId);
    const checkbox = page.getByRole("checkbox", {
      name: /Require confirmation for memory changes/,
    });
    const save = () => saveMemorySettings(page);
    await open();
    await checkbox.scrollIntoViewIfNeeded();
    await expect(checkbox).not.toBeChecked();
    // Keyboard operation uses the same shared control as the actual dashboard.
    await checkbox.focus();
    await page.keyboard.press("Space");
    await save();
    await open();
    await expect(checkbox).toBeChecked();
    await open("rr-e2e-runtime-current");
    await expect(checkbox).toBeChecked();
    await expect(
      page.getByText(
        /This setting applies to every repository in this workspace/,
      ),
    ).toBeVisible();
    await checkbox.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: info.outputPath(`memory-settings-${viewport.name}.png`),
      fullPage: true,
    });
    await checkbox.uncheck();
    await save();
    await open();
    await expect(checkbox).not.toBeChecked();
    expectNetworkViolations(violations);
  });
