import { expect, test, type Page } from "@playwright/test";
import { subscriptionProfiles } from "../subscription-fixture.ts";
import {
  chooseSetupOption as choose,
  expectNoHorizontalOverflow,
} from "./provider-setup-support.ts";
import {
  connectionsListRegion,
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  noSecrets,
  openAccounts,
  sourceRow,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_SUBSCRIPTIONS !== "1",
  "Controlled --subscription-fixture only; no live provider/native proof.",
);
const gateway = process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL!;
/** Connections' own entry: "Connect account" opens the provider picker. */
async function connectProvider(page: Page, provider: string) {
  await connectionsListRegion(page)
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect a provider" });
  await expect(dialog).toBeVisible();
  await choose(page, "Provider", provider);
  return dialog;
}
const counters = [
  "connects",
  "begins",
  "completes",
  "reconnects",
  "deletes",
  "inference",
  "refresh",
] as const;
type FixtureStats = Record<(typeof counters)[number], number> & {
  operationIds: string[];
};

test("subscription connections use real server actions for all four providers and remain compact on mobile", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const violations: string[] = [];
  // Other specs in the same run share the Gateway fixture: count only the
  // operations this test causes.
  const stats = async (): Promise<FixtureStats> =>
    (await request.get(`${gateway}/__subscription-fixture`)).json();
  const start = await stats();
  const since = async () => {
    const now = await stats();
    return Object.fromEntries(
      counters.map((key) => [key, now[key] - start[key]]),
    ) as Record<(typeof counters)[number], number>;
  };
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  // The SDK deliberately validates a fixed provider origin. Fulfill this one
  // synthetic authorization document in-browser; never connect to xAI/network.
  let authorizationDocuments = 0;
  await context.route("https://auth.x.ai/oauth2/authorize?*", async (route) => {
    authorizationDocuments++;
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Synthetic subscription authorization</title><p>Authorization code</p><code>${authorizationDocuments === 1 ? "synthetic-browser-grok-code" : "synthetic-browser-grok-reconnect-code"}</code>`,
    });
  });
  await openAccounts(page, "rr-e2e-personal-viewer");
  const secrets: string[] = ["synthetic-wrong-subscription-key"];
  const declined = await connectProvider(page, "Kimi");
  await declined.getByLabel(/Subscription key/).fill(secrets[0]!);
  await declined.getByLabel(/Subscription key/).press("Enter");
  await expect(page.getByText("Declined", { exact: true })).toBeVisible();
  await noSecrets(page, secrets);
  for (const profile of subscriptionProfiles.filter(
    (profile) => profile.provider !== "grok",
  )) {
    const dialog = await connectProvider(page, profile.label);
    await expect(dialog.getByRole("link", { name: "Get key" })).toHaveAttribute(
      "href",
      /^https:\/\//,
    );
    await expect(dialog.getByLabel(/Base URL|Sign-in method/)).toHaveCount(0);
    const label = `Browser ${profile.label} subscription`;
    await dialog.getByLabel("Connection name (optional)").fill(label);
    const secret = `synthetic-${profile.provider}-subscription-key`;
    secrets.push(secret);
    await dialog.getByLabel(/Subscription key/).fill(secret);
    // Exercise actual form keyboard submission, not a synthetic API call.
    await dialog.getByLabel(/Subscription key/).press("Enter");
    const row = sourceRow(page, label);
    await expect(row).toBeVisible();
    await expect(row).toContainText(profile.label);
    await expect(row).toContainText(profile.plan);
    await expect(row).not.toContainText("Codex");
    // Every plan, GLM included, can be shared through Access.
    await expect(row).not.toContainText("Personal use");
    await expect(row.getByRole("button", { name: /^Access/ })).toHaveCount(1);
    if (profile.provider === "minimax") {
      await expect(row).not.toContainText(
        /Limits source unavailable|Limits visible to the owner only/,
      );
      await expect(row.getByRole("progressbar")).toHaveCount(0);
    } else {
      await expect(row.getByRole("progressbar")).toHaveCount(2);
      await expect(row).toContainText("Month");
      await row.getByText("Details", { exact: true }).click();
      await expect(row.locator("details")).toContainText("Week");
      await row.getByText("Details", { exact: true }).click();
    }
    await noSecrets(page, secrets);
    if (profile.provider === "glm" || profile.provider === "minimax") {
      await row.getByRole("button", { name: `Actions for ${label}` }).click();
      await page.getByRole("menuitem", { name: "Update API key" }).click();
      const reconnect = page.getByRole("dialog");
      await reconnect.getByLabel(/Subscription key/).fill(secret);
      await reconnect.getByLabel(/Subscription key/).press("Enter");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(row).toBeVisible();
      await expect(sourceRow(page, label)).toHaveCount(1);
      await expect(row).toContainText("Ready");
      await noSecrets(page, secrets);
    }
  }
  const enrollment = await connectProvider(page, "Grok");
  // Grok signs in one way only, so the form asks for no sign-in method.
  await expect(
    enrollment.getByRole("combobox", { name: "Sign-in method" }),
  ).toHaveCount(0);
  await expect(enrollment).not.toContainText("ChatGPT Settings");
  await enrollment
    .getByLabel("Connection name")
    .fill("Browser Grok subscription");
  const popup = page.waitForEvent("popup");
  await enrollment.getByRole("button", { name: "Sign in to Grok" }).click();
  const authorization = await popup;
  await expect.poll(() => authorizationDocuments).toBe(1);
  const authorizationCode = await authorization.locator("code").innerText();
  await authorization.close();
  await page.reload({ waitUntil: "domcontentloaded" });
  // Readback restores original Grok plain-code grammar, not transient React state.
  await page.getByRole("button", { name: "Resume authorization" }).click();
  const completion = page.getByRole("dialog", {
    name: "Complete authorization",
  });
  await expect(
    completion.getByLabel("Authorization result address"),
  ).toHaveCount(0);
  await completion
    .getByLabel("Authorization code", { exact: true })
    .fill(authorizationCode);
  await completion
    .getByRole("button", { name: "Complete authorization" })
    .click();
  await expect(sourceRow(page, "Browser Grok subscription")).toBeVisible();
  await noSecrets(page, [...secrets, authorizationCode]);
  const grokRow = sourceRow(page, "Browser Grok subscription");
  await grokRow
    .getByRole("button", { name: "Actions for Browser Grok subscription" })
    .click();
  await page.getByRole("menuitem", { name: "Refresh Grok sign-in" }).click();
  const reconnectDialog = page.getByRole("dialog");
  const reconnectPopup = page.waitForEvent("popup");
  await reconnectDialog
    .getByRole("button", { name: "Sign in to Grok" })
    .click();
  const reconnectAuthorization = await reconnectPopup;
  await expect.poll(() => authorizationDocuments).toBe(2);
  const reconnectCode = await reconnectAuthorization
    .locator("code")
    .innerText();
  await reconnectAuthorization.close();
  const reconnectCompletion = page.getByRole("dialog", {
    name: "Complete authorization",
  });
  await reconnectCompletion
    .getByLabel("Authorization code", { exact: true })
    .fill(reconnectCode);
  await reconnectCompletion
    .getByRole("button", { name: "Complete authorization" })
    .click();
  await expect(grokRow).toBeVisible();
  await expect.poll(async () => (await since()).completes).toBe(2);
  await noSecrets(page, [...secrets, reconnectCode]);
  await expect(grokRow).toContainText("Ready");
  await expect(grokRow.getByRole("progressbar")).toHaveCount(2);
  const glmReceipt = page.getByRole("status").filter({
    hasText: "Browser GLM subscription",
  });
  await expect(glmReceipt).not.toContainText("Personal use");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("subscriptions-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("subscriptions-mobile.png"),
    fullPage: true,
  });
  // A reload only reads: it repeats no connect or sign-in.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(sourceRow(page, "Browser GLM subscription")).toBeVisible();
  expect(await since()).toMatchObject({
    connects: 3,
    begins: 1,
    completes: 2,
    reconnects: 3,
    inference: 0,
    refresh: 0,
  });
  const { operationIds } = await stats();
  expect(new Set(operationIds).size).toBe(operationIds.length);
  const removed = sourceRow(page, "Browser Grok subscription");
  await removed
    .getByRole("button", { name: "Actions for Browser Grok subscription" })
    .click();
  await page.getByRole("menuitem", { name: "Remove connection…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove connection permanently" })
    .click();
  await expect.poll(async () => (await since()).deletes).toBe(1);
  await expect
    .poll(
      async () =>
        (await removed.count()) === 0 ||
        (await removed.textContent())?.includes("Retired"),
    )
    .toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    removed.getByRole("button", { name: "Refresh Grok sign-in" }),
  ).toHaveCount(0);
  for (const provider of ["GLM", "MiniMax"]) {
    const label = `Browser ${provider} subscription`;
    const row = sourceRow(page, label);
    await row.getByRole("button", { name: `Actions for ${label}` }).click();
    await page.getByRole("menuitem", { name: "Remove connection…" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove connection permanently" })
      .click();
    await expect
      .poll(
        async () =>
          (await row.count()) === 0 ||
          (await row.textContent())?.includes("Retired"),
      )
      .toBe(true);
    await noSecrets(page, secrets);
  }
  await expect.poll(async () => (await since()).deletes).toBe(3);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const provider of ["GLM", "MiniMax"]) {
    const row = sourceRow(page, `Browser ${provider} subscription`);
    if (await row.count()) await expect(row).toContainText("Retired");
  }
  await openAccounts(page, "rr-e2e-org-alpha");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  // An organization workspace offers GLM through the user's own connection.
  // Only the offer is checked here; adding it to the organization is covered
  // by personal-connect-attach.test.ts.
  await choose(page, "Owner", "You · personal account");
  const addDialog = page.getByRole("dialog");
  const provider = addDialog.getByRole("combobox", {
    name: "Provider",
    exact: true,
  });
  // The dialog may first resume this tab's latest request.
  const another = addDialog.getByRole("button", {
    name: "Add another account",
  });
  await expect(provider.or(another)).toBeVisible();
  if (await another.isVisible()) await another.click();
  await provider.click();
  await expect(page.getByRole("option", { name: /^GLM(?:\s|$)/ })).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");
  // Escape may dismiss the select and dialog together. A second keyboard
  // dismissal also closes the dialog when the select consumed the first one.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNetworkViolations(violations);
});
