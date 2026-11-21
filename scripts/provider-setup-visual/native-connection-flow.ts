import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";
import type { FlowRun, VisualFlow } from "./flows.js";
import { workspaceRoute } from "./ui.js";
import {
  VISUAL_NATIVE_COMPLETION,
  VISUAL_NATIVE_DOCUMENT,
  VISUAL_NATIVE_PROFILE,
  VISUAL_NATIVE_SECRET,
} from "./native-catalog-fixture.js";

async function chooseMethod(page: Page, dialog: Locator, label: string) {
  await dialog.getByRole("combobox", { name: "Connection method" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function openNative(page: Page) {
  await page
    .getByRole("button", { name: /Add account|Connect account/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect a provider" });
  await dialog.waitFor();
  await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
  await page.getByRole("option", { name: "New native provider" }).click();
  await dialog.getByLabel("Project", { exact: true }).waitFor();
  return dialog;
}

async function fillIdentity(page: Page, dialog: Locator) {
  await dialog.getByLabel("Project", { exact: true }).fill("visual-project");
  await dialog.getByRole("combobox", { name: "Region", exact: true }).click();
  await page.getByRole("option", { name: "Europe", exact: true }).click();
  await dialog
    .getByLabel("Identity document", { exact: true })
    .fill(VISUAL_NATIVE_DOCUMENT);
  await dialog
    .getByLabel("Identity secret", { exact: true })
    .fill(VISUAL_NATIVE_SECRET);
}

async function assertNoSecrets(page: Page) {
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const secret of [
    VISUAL_NATIVE_SECRET,
    VISUAL_NATIVE_DOCUMENT,
    VISUAL_NATIVE_COMPLETION,
    "transient-once",
    "VISUAL-CODE",
  ])
    assert.equal(
      storage.includes(secret),
      false,
      "credentials and challenges must not enter browser storage",
    );
  const inputs = await page
    .locator("input, textarea")
    .evaluateAll((fields) =>
      fields.map((field) => (field as HTMLInputElement).value).join("\n"),
    );
  for (const secret of [
    VISUAL_NATIVE_SECRET,
    VISUAL_NATIVE_DOCUMENT,
    VISUAL_NATIVE_COMPLETION,
  ])
    assert.equal(
      inputs.includes(secret),
      false,
      "submitted secret must leave live DOM inputs",
    );
}

async function waitForAccount(flow: FlowRun, label: string, revision = 1) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const account = await flow.prisma.providerAccountConnection.findFirst({
      where: { profileRef: VISUAL_NATIVE_PROFILE, displayName: label },
    });
    if (account && account.metadataRevision === revision) {
      assert.equal(account.state, "active");
      return account;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`native account not projected into PostgreSQL: ${label}`);
}

export const nativeConnectionFlow: VisualFlow = {
  id: "flow-native-connections",
  title:
    "Native catalog drives all three connection interactions; recovery retains the original method and credentials remain transient",
  requires: { personalSharing: false },
  run: async (flow) => {
    const fixture = flow.env.nativeOperations;
    assert.ok(fixture, "native Gateway fixture required");
    const page = await flow.open("owner", workspaceRoute("main", "setup"));
    // This synthetic authorization page is the only allowed off-app browser origin.
    await page.context().route("https://identity.example.invalid/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "Synthetic authorization complete",
      }),
    );
    let dialog = await openNative(page);
    await flow.check(
      "new provider is usable beside an unsupported method",
      async () => {
        await dialog
          .getByRole("combobox", { name: "Connection method" })
          .click();
        assert.equal(
          await page
            .getByRole("option", { name: /Future interaction/ })
            .getAttribute("aria-disabled"),
          "true",
        );
        await page.keyboard.press("Escape");
        await fillIdentity(page, dialog);
        await chooseMethod(page, dialog, "Browser sign-in");
        await chooseMethod(page, dialog, "Service identity");
        assert.equal(
          await dialog
            .getByLabel("Identity secret", { exact: true })
            .inputValue(),
          "",
        );
        assert.equal(
          await dialog
            .getByLabel("Identity document", { exact: true })
            .inputValue(),
          "",
        );
        await fillIdentity(page, dialog);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        dialog = await openNative(page);
        assert.equal(
          await dialog
            .getByLabel("Identity secret", { exact: true })
            .inputValue(),
          "",
        );
      },
    );
    await flow.shot(page, "native-structured-form");
    await flow.check(
      "structured native credentials create a real RR connection",
      async () => {
        await fillIdentity(page, dialog);
        await dialog
          .getByLabel("Connection name", { exact: true })
          .fill("Visual native structured");
        await dialog
          .getByRole("button", {
            name: "Connect New native provider",
            exact: true,
          })
          .click();
        await waitForAccount(flow, "Visual native structured");
        await assertNoSecrets(page);
        assert.ok(
          fixture
            .evidence()
            .some(
              (effect) =>
                effect.action === "begin" &&
                effect.methodId === "structured" &&
                effect.inputAccepted,
            ),
        );
      },
    );
    await flow.shot(page, "native-structured-applied");
    await page.reload();
    await flow.check(
      "native reconnect preserves the account and clears cancelled credentials",
      async () => {
        const before = await waitForAccount(flow, "Visual native structured");
        const connectionRow = page
          .locator("div")
          .filter({
            has: page.getByText("Visual native structured", { exact: true }),
          })
          .filter({
            has: page.getByRole("button", { name: "Reconnect", exact: true }),
          })
          .last();
        const openReconnect = async () => {
          await connectionRow
            .getByRole("button", { name: "Reconnect", exact: true })
            .click();
          const reconnectDialog = page.getByRole("dialog", {
            name: "Reconnect New native provider",
            exact: true,
          });
          await reconnectDialog.waitFor();
          return reconnectDialog;
        };
        let reconnectDialog = await openReconnect();
        await fillIdentity(page, reconnectDialog);
        await page.keyboard.press("Escape");
        await reconnectDialog.waitFor({ state: "hidden" });
        assert.equal(
          fixture.evidence().filter((effect) => effect.action === "reconnect")
            .length,
          0,
        );
        await assertNoSecrets(page);
        reconnectDialog = await openReconnect();
        for (const label of ["Identity document", "Identity secret"])
          assert.equal(
            await reconnectDialog
              .getByLabel(label, { exact: true })
              .inputValue(),
            "",
          );
        await fillIdentity(page, reconnectDialog);
        await reconnectDialog
          .getByRole("button", {
            name: "Reconnect New native provider",
            exact: true,
          })
          .click();
        await reconnectDialog.waitFor({ state: "hidden" });
        const after = await waitForAccount(flow, "Visual native structured", 2);
        assert.equal(after.id, before.id);
        assert.equal(after.gatewayAccountRef, before.gatewayAccountRef);
        assert.equal(
          await flow.prisma.providerAccountConnection.count({
            where: {
              profileRef: VISUAL_NATIVE_PROFILE,
              displayName: "Visual native structured",
            },
          }),
          1,
        );
        assert.deepEqual(
          fixture.evidence().filter((effect) => effect.action === "reconnect"),
          [
            {
              action: "reconnect",
              methodId: "structured",
              inputAccepted: true,
            },
          ],
        );
        await assertNoSecrets(page);
      },
    );
    await flow.shot(page, "native-structured-reconnected");
    await page.reload();
    dialog = await openNative(page);
    await flow.check(
      "browser authorization resumes after catalog disappears",
      async () => {
        await chooseMethod(page, dialog, "Browser sign-in");
        await dialog
          .getByLabel("Connection name", { exact: true })
          .fill("Visual native browser");
        await dialog
          .getByRole("button", {
            name: "Connect New native provider",
            exact: true,
          })
          .click();
        await page.getByLabel("Authorization code", { exact: true }).waitFor();
        fixture.setDiscoveryAvailable(false);
        await page.reload();
        const resume = page.getByRole("button", {
          name: "Resume authorization",
          exact: true,
        });
        // The pinned operation is loaded asynchronously after a page reload.
        // A synchronous count can run before that read resolves and miss the
        // only user action that opens the completion form.
        await resume.first().waitFor({ state: "visible" });
        await resume.first().click();
        await page
          .getByLabel("Authorization code", { exact: true })
          .fill(VISUAL_NATIVE_COMPLETION);
        await page
          .getByRole("button", { name: "Complete authorization", exact: true })
          .click();
        await waitForAccount(flow, "Visual native browser");
        await assertNoSecrets(page);
        assert.ok(
          fixture
            .evidence()
            .some(
              (effect) =>
                effect.action === "submit" &&
                effect.methodId === "browser" &&
                effect.inputAccepted,
            ),
        );
        fixture.setDiscoveryAvailable(true);
      },
    );
    await flow.shot(page, "native-browser-recovered");
    await page.reload();
    dialog = await openNative(page);
    await flow.check(
      "device authorization polls the pinned operation",
      async () => {
        await chooseMethod(page, dialog, "Device code");
        await dialog
          .getByLabel("Connection name", { exact: true })
          .fill("Visual native device");
        await dialog
          .getByRole("button", {
            name: "Connect New native provider",
            exact: true,
          })
          .click();
        await page.getByText("VISUAL-CODE", { exact: true }).waitFor();
        const signIn = page.getByRole("link", {
          name: "Open New native provider",
          exact: true,
        });
        assert.equal(
          await signIn.getAttribute("href"),
          "https://identity.example.invalid/device",
        );
        // A provider grants the device authorization after the user sees the
        // code. Automatic success on the first background poll can remove the
        // handoff before the browser observes it, bypassing this user step.
        fixture.authorizeDevice("Visual native device");
        await waitForAccount(flow, "Visual native device");
        await assertNoSecrets(page);
        const evidence = fixture.evidence();
        assert.equal(
          evidence.filter((effect) => effect.action === "begin").length,
          3,
        );
        assert.ok(
          evidence.some(
            (effect) =>
              effect.action === "poll" &&
              effect.methodId === "device" &&
              effect.inputAccepted,
          ),
        );
        assert.equal(
          evidence.every((effect) => effect.inputAccepted),
          true,
        );
      },
    );
    await flow.shot(page, "native-device-applied");
  },
};
