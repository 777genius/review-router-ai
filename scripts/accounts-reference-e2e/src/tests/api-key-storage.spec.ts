import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FIXTURES } from "../contracts.ts";
import { withDatabase } from "../database.ts";
import { apiKeyStorageProfiles } from "../subscription-fixture.ts";
import {
  chooseSetupOption as choose,
  openNewProvider,
} from "./provider-setup-support.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  sourceRow,
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

async function accountsReady(
  page: Page,
  navigate: () => Promise<unknown>,
): Promise<readonly string[]> {
  // Existing Accounts reference hydration witness; keep the continuation URL.
  const hydrated = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/dashboard/accounts/access" &&
        url.searchParams.get("view") === "summaries" &&
        response.request().method() === "GET"
      );
    },
    { timeout: 60_000 },
  );
  await navigate();
  await expect(
    page.getByRole("region", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
  const summaries = await hydrated;
  expect(summaries.ok()).toBe(true);
  await summaries.body();
  const request = JSON.parse(
    new URL(summaries.url()).searchParams.get("request")!,
  ) as { sourceIds: string[] };
  return request.sourceIds;
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

async function noSecrets(page: Page, secrets: readonly string[]) {
  const retained = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      location: location.href,
      markup: document.body.innerHTML,
      inputValues: Array.from(
        document.querySelectorAll("input"),
        (input) => input.value,
      ),
    }),
  );
  for (const secret of secrets) expect(retained).not.toContain(secret);
}

function captureSecretLeaks(page: Page, secrets: readonly string[]) {
  const leakedChannels = new Set<string>();
  const pending = new Set<Promise<void>>();
  let inspectedResponses = 0;
  const inspect = (channel: string, value: string) => {
    if (secrets.some((secret) => value.includes(secret)))
      leakedChannels.add(channel);
  };
  page.on("console", (message) => inspect("browser console", message.text()));
  page.on("pageerror", (error) => inspect("browser error", error.message));
  page.on("requestfinished", (request) => {
    // Next may keep speculative navigation streams open. Inspect complete
    // responses instead of waiting forever after their headers arrive.
    const reading: Promise<void> = (async () => {
      const response = await request.response();
      if (
        !response ||
        !/json|text\/html|text\/x-component/.test(
          response.headers()["content-type"] ?? "",
        )
      )
        return;
      try {
        const body = await response.text();
        inspectedResponses += 1;
        inspect("HTTP/SSR response", body);
      } catch {
        leakedChannels.add("unreadable completed HTTP/SSR response");
      }
    })().finally(() => pending.delete(reading));
    pending.add(reading);
  });
  const drain = async () => {
    // A body read can finish while another completed response is queued.
    // Drain all of them before navigation can evict the previous document.
    while (pending.size) await Promise.all([...pending]);
  };
  return {
    drain,
    verify: async () => {
      await drain();
      expect(inspectedResponses).toBeGreaterThan(0);
      const workDir = dirname(process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON!);
      for (const name of [
        "next-app.log",
        "gateway-requests.jsonl",
        "runtime.json",
        "boot-report.json",
        "boot-viewer.html",
      ]) {
        inspect(name, await readFile(join(workDir, name), "utf8"));
      }
      // Report the channel only; never copy a secret into assertion diagnostics.
      expect([...leakedChannels]).toEqual([]);
    },
  };
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
    replacement.getByRole("combobox", { name: "Provider", exact: true }),
  ).toContainText("Kimi Code");
  await expect(
    (await expectStorage(replacement)).getByRole("radio", {
      name: /^ReviewRouter/,
    }),
  ).toBeChecked();
  await expect(
    replacement.getByRole("link", { name: "Connect account", exact: true }),
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

test("API key storage connects all three accounts and returns to the same provider setup", async ({
  page,
  context,
  request,
}, info) => {
  test.setTimeout(480_000);
  const violations: string[] = [];
  const secrets: string[] = [];
  const { drain: drainSecretResponses, verify: verifySecretChannels } =
    captureSecretLeaks(page, [
      "synthetic-unsent-storage-switch-key",
      ...providers.map(
        (provider) => `synthetic-${provider.id}-subscription-key`,
      ),
    ]);
  await useViewerSession(context);
  await installLoopbackOnlyNetworkGuard(page, violations);
  await page.addInitScript(() =>
    localStorage.setItem("reviewrouter-theme", "light"),
  );
  for (const provider of providers) {
    const profile = apiKeyStorageProfiles.find(
      (row) => row.provider === provider.id,
    )!;
    const before = await savedProfiles();
    await drainSecretResponses();
    const dialog = await beginProvider(page, provider.label);
    await (await expectStorage(dialog))
      .getByRole("radio", { name: /^ReviewRouter/ })
      .check();
    await expect(
      dialog.getByRole("heading", { name: "Model and review settings" }),
    ).toHaveCount(0);
    const connect = dialog.getByRole("link", {
      name: "Connect account",
      exact: true,
    });
    const accountsHref = await connect.getAttribute("href");
    expect(accountsHref).toContain(`workspace=${workspace}`);
    expect(accountsHref).toContain(`keyProvider=${provider.id}`);
    await drainSecretResponses();
    let previousSourceIds = await accountsReady(page, () => connect.click());
    await page
      .getByRole("button", { name: "Connect account", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Connect with API key", exact: true })
      .click();
    const enrollment = page.getByRole("dialog");
    await expect(
      enrollment.getByRole("combobox", {
        name: "Provider profile",
        exact: true,
      }),
    ).toContainText(profile.label);
    const choice = await expectStorage(enrollment);
    if (provider.id === "openrouter") {
      const erased = "synthetic-unsent-storage-switch-key";
      await enrollment.locator('input[type="password"]').fill(erased);
      await choice.getByRole("radio", { name: /^GitHub Secrets/ }).check();
      await expect(enrollment.locator('input[type="password"]')).toHaveCount(0);
      await noSecrets(page, [erased]);
      await drainSecretResponses();
      await enrollment
        .getByRole("link", { name: "Continue to provider setup", exact: true })
        .click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("radio", { name: /^GitHub Secrets/ }),
      ).toBeChecked();
      expect(await savedProfiles()).toEqual(before);
      await drainSecretResponses();
      previousSourceIds = await accountsReady(page, () =>
        page.goto(accountsHref!),
      );
      await page
        .getByRole("button", { name: "Connect account", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Connect with API key", exact: true })
        .click();
      await expect(
        enrollment.getByRole("combobox", {
          name: "Provider profile",
          exact: true,
        }),
      ).toContainText(profile.label);
    }
    await enrollment.getByRole("radio", { name: /^ReviewRouter/ }).check();
    const runLabel =
      process.env.ACCOUNTS_REFERENCE_E2E_RESULT_JSON?.split("/").at(-2) ??
      "fixture";
    const name = `Storage E2E ${provider.label} ${runLabel}`;
    await enrollment.getByLabel("Connection name (optional)").fill(name);
    const secret = `synthetic-${provider.id}-subscription-key`;
    secrets.push(secret);
    await enrollment.locator('input[type="password"]').fill(secret);
    // Enrollment first invalidates the old source list, then requests summaries
    // for the new list. Wait for the newly enrolled source, not an older refresh,
    // before navigation can evict the response the canary observer must inspect.
    const refreshedAccess = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        if (
          url.pathname !== "/api/dashboard/accounts/access" ||
          url.searchParams.get("view") !== "summaries" ||
          response.request().method() !== "GET"
        )
          return false;
        const summaryRequest = JSON.parse(
          url.searchParams.get("request") ?? "{}",
        ) as { sourceIds?: string[] };
        return (
          summaryRequest.sourceIds?.some(
            (id) => !previousSourceIds.includes(id),
          ) === true
        );
      },
      { timeout: 60_000 },
    );
    await enrollment.locator('input[type="password"]').press("Enter");
    await expect(sourceRow(page, name)).toBeVisible();
    const accessResponse = await refreshedAccess;
    expect(accessResponse.ok()).toBe(true);
    const accessBody = await accessResponse.text();
    expect(secrets.some((value) => accessBody.includes(value))).toBe(false);
    await noSecrets(page, secrets);
    const back = page.getByRole("link", {
      name: "Back to provider setup",
      exact: true,
    });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute(
      "href",
      new RegExp(`keyProvider=${provider.id}`),
    );
    await drainSecretResponses();
    await back.click();
    const returned = page.getByRole("dialog");
    await expect(
      returned.getByRole("combobox", { name: "Provider", exact: true }),
    ).toContainText(provider.label);
    await expect(
      returned.getByRole("radio", { name: /^ReviewRouter/ }),
    ).toBeChecked();
    await choose(page, "Account", name);
    await expect(
      returned.getByRole("combobox", { name: "Model", exact: true }),
    ).toContainText(profile.model);
    if (provider.id === "kimi") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: info.outputPath("key-storage-desktop-light.png"),
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
        path: info.outputPath("key-storage-mobile-light.png"),
        fullPage: true,
      });
    }
    const added = await createWithoutDefault(page, before);
    expect(added).toMatchObject({
      credentialKind: "gateway_binding",
      authMode: "codex_account_gateway",
      gatewayProfileRef: profile.profileId,
      apiKeyConnectionId: null,
      model: profile.model,
    });
    expect(added.gatewayBindingId).toBeTruthy();
    for (const original of before)
      expect(
        (await savedProfiles()).find((row) => row.id === original.id),
      ).toEqual(original);
  }
  const stats = await (
    await request.get(
      `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__subscription-fixture`,
    )
  ).json();
  expect(stats).toMatchObject({ connects: 3, inference: 0, refresh: 0 });
  await verifySecretChannels();
  await expectNetworkViolations(violations);
});
