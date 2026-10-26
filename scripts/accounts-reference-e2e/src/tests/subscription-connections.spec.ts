import { expect, test, type Page } from "@playwright/test";
import { subscriptionProfiles } from "../subscription-fixture.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  openAccounts,
  sourceRow,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_SUBSCRIPTIONS !== "1",
  "Controlled --subscription-fixture only; no live provider/native proof.",
);
const gateway = process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL!;
async function choose(page: Page, name: string, value: string) {
  await page.getByRole("combobox", { name }).click();
  await page.getByRole("option", { name: value }).click();
}
async function keyForm(page: Page, provider: string) {
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Connect with API key" }).click();
  await choose(page, "Provider profile", provider);
}
async function noSecrets(page: Page, values: string[]) {
  const retained = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      location: location.href,
      markup: document.body.innerHTML,
    }),
  );
  for (const value of values) expect(retained).not.toContain(value);
}

test("subscription connections use real server actions for all four providers and remain compact on mobile", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const violations: string[] = [];
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
  await keyForm(page, "Kimi");
  await page
    .getByRole("dialog")
    .getByLabel(/Subscription key/)
    .fill(secrets[0]!);
  await page
    .getByRole("dialog")
    .getByLabel(/Subscription key/)
    .press("Enter");
  await expect(page.getByText("Declined", { exact: true })).toBeVisible();
  await noSecrets(page, secrets);
  for (const profile of subscriptionProfiles.filter(
    (profile) => profile.provider !== "grok",
  )) {
    await keyForm(page, profile.label);
    const dialog = page.getByRole("dialog");
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
    if (profile.provider === "glm") {
      await expect(row).toContainText("Personal use");
      await expect(row.getByRole("button", { name: /^Access/ })).toHaveCount(0);
    }
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
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Connect Grok OAuth" }).click();
  const enrollment = page.getByRole("dialog");
  // Only Grok is enabled by this fixture, so no auth-method/provider wizard.
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
  await expect
    .poll(
      async () =>
        (await (await request.get(`${gateway}/__subscription-fixture`)).json())
          .completes,
    )
    .toBe(2);
  await noSecrets(page, [...secrets, reconnectCode]);
  await expect(grokRow).toContainText("Ready");
  await expect(grokRow.getByRole("progressbar")).toHaveCount(2);
  const glmReceipt = page.getByRole("status").filter({
    hasText: "Browser GLM subscription",
  });
  await expect(glmReceipt).toContainText("Personal use.");
  await expect(glmReceipt).not.toContainText("Organization access");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("subscriptions-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("subscriptions-mobile.png"),
    fullPage: true,
  });
  const before = await (
    await request.get(`${gateway}/__subscription-fixture`)
  ).json();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(sourceRow(page, "Browser GLM subscription")).toBeVisible();
  const after = await (
    await request.get(`${gateway}/__subscription-fixture`)
  ).json();
  expect(after).toMatchObject({
    connects: 3,
    begins: 1,
    completes: 2,
    reconnects: 3,
    inference: 0,
    refresh: 0,
  });
  expect(after.connects).toBe(before.connects);
  expect(new Set(after.operationIds).size).toBe(after.operationIds.length);
  const removed = sourceRow(page, "Browser Grok subscription");
  await removed
    .getByRole("button", { name: "Actions for Browser Grok subscription" })
    .click();
  await page.getByRole("menuitem", { name: "Remove connection…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove connection permanently" })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${gateway}/__subscription-fixture`)).json())
          .deletes,
    )
    .toBe(1);
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
  await expect
    .poll(
      async () =>
        (await (await request.get(`${gateway}/__subscription-fixture`)).json())
          .deletes,
    )
    .toBe(3);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const provider of ["GLM", "MiniMax"]) {
    const row = sourceRow(page, `Browser ${provider} subscription`);
    if (await row.count()) await expect(row).toContainText("Retired");
  }
  await openAccounts(page, "rr-e2e-org-alpha");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await choose(page, "Owner", "RR E2E Org Alpha · organization account");
  await page.getByRole("combobox", { name: "Provider", exact: true }).click();
  await expect(page.getByRole("option", { name: /^GLM(?:\s|$)/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  // Escape may dismiss the select and dialog together. A second keyboard
  // dismissal also closes the dialog when the select consumed the first one.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNetworkViolations(violations);
});
