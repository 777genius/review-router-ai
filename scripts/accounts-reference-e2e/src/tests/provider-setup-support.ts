import { expect, type Page } from "@playwright/test";

/** Open the current Providers dialog through its real, hydrated navigation. */
export async function openNewProvider(page: Page, workspaceId: string) {
  await page.goto(`/dashboard?section=providers&workspace=${workspaceId}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
  const dialog = page.getByRole("dialog");
  // Opening is reversible. Do not retry a save or enrollment operation.
  await expect(async () => {
    if (!(await dialog.isVisible()))
      await page
        .getByRole("button", { name: "Add provider", exact: true })
        .click();
    await expect(
      dialog.getByRole("combobox", { name: "Provider", exact: true }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await expect(
    dialog.getByRole("heading", { name: "Model and review settings" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("textbox", { name: "Model", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: /^Account\b/ }),
  ).toHaveCount(0);
  return dialog;
}

export async function chooseSetupOption(
  page: Page,
  label: string,
  value: string,
) {
  const control = page.getByRole("dialog").getByRole("combobox", {
    name: label === "Account" ? /^Account\b/ : label,
    exact: true,
  });
  await expect(control).toBeVisible({ timeout: 60_000 });
  const option = page.getByRole("option").filter({ hasText: value });
  await expect(async () => {
    if (!(await page.getByRole("listbox").count())) await control.click();
    await expect(option).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await option.click();
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}
