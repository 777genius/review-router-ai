import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { withDatabase } from "../database.ts";
import {
  chooseSetupOption as choose,
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
const providers = [
  {
    id: "openrouter",
    label: "OpenRouter",
    authMode: "openrouter_api_key",
    model: "openai/gpt-5.4-mini",
  },
  {
    id: "mimo",
    label: "MiMo Token Plan",
    authMode: "mimo_token_plan_api_key",
    model: "mimo-v2.6-pro",
  },
  {
    id: "kimi",
    label: "Kimi Code",
    authMode: "kimi_code_api_key",
    model: "k3-256k",
  },
] as const;

type Profile = {
  id: string;
  label: string;
  authMode: string;
  credentialKind: string;
  gatewayBindingId: string | null;
  gatewayProfileRef: string | null;
  apiKeyConnectionId: string | null;
  model: string;
};

async function savedProfiles(): Promise<Profile[]> {
  return withDatabase(
    process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
    async (db) =>
      (
        await db.query<Profile>(
          `SELECT id,label,"authMode","credentialKind","gatewayBindingId","gatewayProfileRef","apiKeyConnectionId",model FROM "WorkspaceProviderProfile" WHERE "workspaceId"=$1 AND "archivedAt" IS NULL ORDER BY id`,
          [workspace],
        )
      ).rows,
  );
}

async function savedWorkspaceUsage(): Promise<Record<string, unknown>> {
  return withDatabase(
    process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
    async (db) => {
      const result = await db.query<{ policyJson: string }>(
        `SELECT v."policyJson" FROM "ReviewConfiguration" c JOIN "ReviewConfigurationVersion" v ON v."configurationId"=c.id WHERE c."workspaceId"=$1 AND c."repositoryId" IS NULL AND c.active ORDER BY v.version DESC LIMIT 1`,
        [workspace],
      );
      expect(result.rows).toHaveLength(1);
      return JSON.parse(result.rows[0]!.policyJson).providers[0];
    },
  );
}

async function beginProvider(page: Page, label: string) {
  await openNewProvider(page, workspace);
  await choose(page, "Provider", label);
  return page.getByRole("dialog");
}

async function expectStorage(dialog: Locator) {
  const choice = dialog.getByRole("radiogroup", { name: "Key storage" });
  await expect(choice.getByRole("radio")).toHaveCount(2);
  await expect(choice).toContainText(
    "Add the key to each repository on GitHub.",
  );
  await expect(choice).toContainText(
    "Store the key encrypted and reuse it across repositories.",
  );
  return choice;
}

async function createWithoutDefault(page: Page, before: readonly Profile[]) {
  const dialog = page.getByRole("dialog");
  const useDefault = dialog.getByRole("checkbox", {
    name: /Use as workspace default/,
  });
  if (await useDefault.isChecked()) await useDefault.uncheck();
  await dialog
    .getByRole("button", { name: "Add provider", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: "Finish repository setup" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  const added = (await savedProfiles()).filter(
    (row) => !before.some((old) => old.id === row.id),
  );
  expect(added).toHaveLength(1);
  return added[0]!;
}

test("API key storage creates all three GitHub profiles and preserves identity when changing storage", async ({
  page,
  context,
}, info) => {
  test.setTimeout(480_000);
  const violations: string[] = [];
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  await page.addInitScript(() =>
    localStorage.setItem("reviewrouter-theme", "dark"),
  );
  const created: Profile[] = [];
  for (const provider of providers) {
    const before = await savedProfiles();
    const dialog = await beginProvider(page, provider.label);
    const storage = await expectStorage(dialog);
    await storage.getByRole("radio", { name: /^GitHub Secrets/ }).check();
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: /^Account\b/ }),
    ).toHaveCount(0);
    await dialog.getByLabel("Model", { exact: true }).fill(provider.model);
    await dialog
      .getByRole("checkbox", { name: /Use as workspace default/ })
      .focus();
    await expect(dialog.getByRole("listbox")).toHaveCount(0);
    await expect(
      dialog.getByRole("checkbox", { name: /Read related files/ }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Test connection", exact: true }),
    ).toHaveCount(0);
    if (provider.id === "kimi") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(
        dialog.getByRole("combobox", { name: /^Review depth\b/ }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("checkbox", { name: /Fast mode/ }),
      ).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: info.outputPath("key-storage-desktop-dark.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath("key-storage-mobile-dark.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const added = await createWithoutDefault(page, before);
    expect(added).toMatchObject({
      credentialKind: "user_ci_secret",
      authMode: provider.authMode,
      model: provider.model,
      gatewayBindingId: null,
      gatewayProfileRef: null,
      apiKeyConnectionId: null,
    });
    created.push(added);
  }
  const original = created[2]!;
  const row = page
    .getByText(original.label, { exact: true })
    .locator("xpath=ancestor::li");
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Key storage: GitHub Secrets",
  );
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Add with different storage", exact: true })
    .click();
  const replacement = page.getByRole("dialog");
  await expect(
    replacement
      .getByRole("radiogroup", { name: "Provider" })
      .getByRole("radio", { name: "Kimi Code", exact: true }),
  ).toBeChecked();
  await expect(
    (await expectStorage(replacement)).getByRole("radio", {
      name: /^ReviewRouter/,
    }),
  ).toBeChecked();
  // ReviewRouter storage connects Kimi in the dialog itself, or offers a new
  // connection beside one an earlier step left in this workspace.
  await expect(
    replacement
      .getByRole("region", { name: "Connect Kimi Code" })
      .or(replacement.getByRole("button", { name: "New connection" })),
  ).toBeVisible();
  expect(
    (await savedProfiles()).find((profile) => profile.id === original.id),
  ).toEqual(original);
  expect(await savedProfiles()).toHaveLength(created.length);
  await replacement
    .getByRole("button", { name: "Close provider setup" })
    .click();
  // File reading belongs to the usage selection. Saving it must not rewrite
  // the reusable model/credential profile or invent Kimi reasoning settings.
  for (const profile of [created[0]!, created[2]!]) {
    await page.goto(`/dashboard?section=providers&workspace=${workspace}`);
    const savedRow = page
      .getByText(profile.label, { exact: true })
      .locator("xpath=ancestor::li");
    await savedRow
      .getByRole("button", { name: "Make default", exact: true })
      .click();
    const settings = page.getByRole("dialog");
    await expect(
      settings.getByRole("combobox", { name: /^Account\b/ }),
    ).toHaveCount(0);
    const related = settings.getByRole("checkbox", {
      name: /Read related files/,
    });
    await expect(related).toBeChecked();
    await related.uncheck();
    await settings
      .getByRole("button", { name: "Set as default", exact: true })
      .click();
    await expect(
      settings.getByRole("heading", { name: "Workspace default saved" }),
    ).toBeVisible();
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await page.reload();
    const usage = await savedWorkspaceUsage();
    expect(usage).toMatchObject({
      profileId: profile.id,
      agenticContext: false,
      fastMode: false,
    });
    if (profile.authMode === "openrouter_api_key")
      expect(usage.reasoningEffort).toBe("xhigh");
    else expect(usage).not.toHaveProperty("reasoningEffort");
    expect(
      (await savedProfiles()).find((value) => value.id === profile.id),
    ).toEqual(profile);
    const read = await page.request.get(
      `/api/dashboard/provider-setup?workspace=${workspace}`,
    );
    expect(read.ok()).toBe(true);
    expect((await read.json()).defaultSelection).toMatchObject({
      profileId: profile.id,
      agenticContext: false,
    });
  }
  await expectNetworkViolations(violations);
});
