/**
 * End-to-end flows of the provider setup qualification (plan S7): each flow
 * starts from a fresh seed, drives the real dashboard as the fixture users
 * would, and checks both what the page shows and what the review-config
 * store holds afterwards. A flow stops at its first failed check and keeps a
 * screenshot of that moment; the manifest records every check.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type {
  Browser,
  Locator,
  Page,
  Request as BrowserRequest,
} from "playwright-core";
import {
  assignProviderProfileToRepositories,
  setWorkspaceDefaultProviders,
  parseStoredReviewPolicy,
  PrismaReviewConfigurationRepository,
  PrismaReviewPolicyHeadReader,
  ProviderManagementDeniedError,
  renameWorkspaceProviderProfile,
  PrismaWorkspaceProviderProfileRepository,
  type EffectiveReviewConfigurationValidatorPort,
} from "../../packages/features/review-config/src/index.js";
import { getDefaultProviderConfigForAuthMode } from "../../packages/features/review-providers/src/index.js";
import {
  gotoDashboard,
  hideDevOverlay,
  openUserPage,
  settle,
  type UserPage,
} from "./capture.js";
import {
  VISUAL_PROFILES,
  VISUAL_REPOSITORIES,
  VISUAL_SELECTION_SETTINGS,
  VISUAL_USERS,
  VISUAL_WORKSPACES,
  visualRepositoryFullName,
  visualRepositorySecretKey,
  type GitHubFixtureState,
  type VisualProfileKey,
  type VisualRepositoryKey,
  type VisualRunFlags,
  type VisualUserKey,
} from "./fixture-contract.js";
import type { VisualTheme } from "./scenarios.js";
import type { VisualSeedResult } from "./seed.js";
import {
  chooseCard,
  chooseModel,
  chooseNewProvider,
  chooseSource,
  openDialog,
  providerListRow,
  repositoryRoute,
  repositoryRowHeader,
  repositorySetupPanel,
  repositoryStepPill,
  SOURCE,
  workspaceRoute,
} from "./ui.js";

export type FlowCheck = Readonly<{
  name: string;
  pass: boolean;
  detail?: string;
}>;

export type FlowRecord = Readonly<{
  flow: string;
  title: string;
  status: "pass" | "fail" | "skipped";
  reason?: string;
  checks: readonly FlowCheck[];
  screenshots: readonly string[];
  pageErrors: readonly string[];
  blockedRequests: readonly string[];
  durationMs: number;
}>;

export type FlowEnvironment = Readonly<{
  browser: Browser;
  appUrl: string;
  sessionCookies: Readonly<Record<VisualUserKey, string>>;
  prisma: PrismaClient;
  flags: VisualRunFlags;
  outDir: string;
  /** Restores the data set and the GitHub state of a fresh seed. */
  reset: () => Promise<VisualSeedResult>;
  writeGitHubState: (state: GitHubFixtureState) => Promise<void>;
}>;

type VisualFlow = Readonly<{
  id: string;
  title: string;
  requires?: Partial<VisualRunFlags>;
  run: (flow: FlowRun) => Promise<void>;
}>;

class FlowCheckFailed extends Error {}

/** One flow's pages, checks and screenshots. */
class FlowRun {
  readonly checks: FlowCheck[] = [];
  readonly screenshots: string[] = [];
  readonly pageErrors: string[] = [];
  readonly blockedRequests: string[] = [];
  private readonly pages: UserPage[] = [];

  constructor(
    readonly env: FlowEnvironment,
    readonly id: string,
    readonly seed: VisualSeedResult,
  ) {}

  get prisma(): PrismaClient {
    return this.env.prisma;
  }

  /** A fresh signed-in page of the user on a dashboard route. */
  async open(
    user: VisualUserKey,
    route: string,
    view: Readonly<{ width?: number; theme?: VisualTheme }> = {},
  ): Promise<Page> {
    const userPage = await openUserPage(this.env.browser, this.env, {
      user,
      width: view.width ?? 1440,
      theme: view.theme ?? "dark",
    });
    this.pages.push(userPage);
    await gotoDashboard(userPage.page, route);
    return userPage.page;
  }

  async check(
    name: string,
    run: () => Promise<string | void> | string | void,
  ): Promise<void> {
    try {
      const detail = await run();
      this.checks.push({ name, pass: true, ...(detail ? { detail } : {}) });
    } catch (error) {
      this.checks.push({ name, pass: false, detail: errorText(error) });
      throw new FlowCheckFailed(name);
    }
  }

  async shot(page: Page, name: string): Promise<void> {
    const file = join(
      "flows",
      `${this.id}--${String(this.screenshots.length + 1).padStart(2, "0")}-${name}.png`,
    );
    await settle(page);
    await hideDevOverlay(page);
    await page.screenshot({
      path: join(this.env.outDir, file),
      animations: "disabled",
      caret: "hide",
    });
    this.screenshots.push(file);
  }

  /** Screenshot of every open page, for a failed check. */
  async evidence(): Promise<void> {
    for (const [index, { page }] of this.pages.entries())
      await this.shot(page, `failure-${index + 1}`).catch(() => undefined);
  }

  async close(): Promise<void> {
    for (const userPage of this.pages) {
      this.pageErrors.push(...userPage.pageErrors);
      this.blockedRequests.push(...userPage.blockedRequests);
      await userPage.context.close().catch(() => undefined);
    }
  }
}

/** Whether `--only` selects any flow. */
export function visualFlowSelected(only: RegExp | null): boolean {
  return VISUAL_FLOWS.some((flow) => !only || only.test(flow.id));
}

export async function runFlows(
  env: FlowEnvironment,
  only: RegExp | null,
): Promise<readonly FlowRecord[]> {
  await mkdir(join(env.outDir, "flows"), { recursive: true, mode: 0o700 });
  const records: FlowRecord[] = [];
  for (const flow of VISUAL_FLOWS) {
    if (only && !only.test(flow.id)) continue;
    const unmet = Object.entries(flow.requires ?? {}).find(
      ([flag, value]) => env.flags[flag as keyof VisualRunFlags] !== value,
    );
    if (unmet) {
      records.push({
        flow: flow.id,
        title: flow.title,
        status: "skipped",
        reason: `needs ${unmet[0]}=${String(unmet[1])}`,
        checks: [],
        screenshots: [],
        pageErrors: [],
        blockedRequests: [],
        durationMs: 0,
      });
      continue;
    }
    const startedAt = Date.now();
    const run = new FlowRun(env, flow.id, await env.reset());
    let reason: string | undefined;
    try {
      await flow.run(run);
    } catch (error) {
      reason =
        error instanceof FlowCheckFailed
          ? `check failed: ${error.message}`
          : errorText(error);
      if (!(error instanceof FlowCheckFailed))
        run.checks.push({ name: "flow step", pass: false, detail: reason });
      await run.evidence();
    } finally {
      await run.close();
    }
    if (!reason && run.pageErrors.length > 0)
      reason = `browser runtime errors: ${run.pageErrors.join("; ")}`;
    if (!reason && run.blockedRequests.length > 0)
      reason = `unexpected browser network requests: ${run.blockedRequests.join("; ")}`;
    const record: FlowRecord = {
      flow: flow.id,
      title: flow.title,
      status: reason === undefined ? "pass" : "fail",
      ...(reason === undefined ? {} : { reason }),
      checks: run.checks,
      screenshots: run.screenshots,
      pageErrors: run.pageErrors,
      blockedRequests: run.blockedRequests,
      durationMs: Date.now() - startedAt,
    };
    records.push(record);
    process.stdout.write(
      `flow ${record.status.padEnd(4)} ${flow.id}${reason ? ` (${reason})` : ""}\n`,
    );
  }
  return records;
}

const VISUAL_FLOWS: readonly VisualFlow[] = [
  {
    id: "flow-gateway-reviewer-roster",
    title:
      "Save, reload, edit and inherit several Gateway reviewers, including stale concurrent editors",
    requires: { personalSharing: false },
    run: async (flow) => {
      const workspaceId = VISUAL_WORKSPACES.main.id;
      const reader = new PrismaReviewPolicyHeadReader(flow.prisma);
      const heads = await reader.readPolicyHeads({
        scope: "workspace",
        workspaceId,
      });
      const settings = {
        reasoningEffort: "high" as const,
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      };
      await setWorkspaceDefaultProviders(
        {
          workspaceId,
          actor: { userId: VISUAL_USERS.admin.id, auditActor: "visual:admin" },
          selections: [
            {
              ...settings,
              profileId: requiredProfile(flow.seed, "gatewayOrg"),
            },
          ],
          expectedVersion: heads.workspace?.version ?? null,
        },
        {
          policyHeads: reader,
          configurations: new PrismaReviewConfigurationRepository(
            flow.prisma,
            undefined,
            false,
            VISUAL_USERS.admin.id,
          ),
          validator: { validate: async () => {} },
        },
      );
      const page = await flow.open(
        "admin",
        workspaceRoute("main", "providers"),
      );
      let dialog = await openDialog(
        page,
        providerListRow(page, VISUAL_PROFILES.gatewayOrg.label).getByRole(
          "button",
          { name: "Review settings", exact: true },
        ),
      );
      await dialog
        .getByRole("button", { name: "Add reviewer", exact: true })
        .click();
      await dialog
        .getByRole("combobox", { name: "Account for reviewer 2", exact: true })
        .click();
      await page.getByRole("option", { name: /Visual Org Codex/ }).click();
      await dialog
        .getByRole("combobox", { name: "Model", exact: true })
        .click();
      await page.getByRole("option", { name: /^gpt-5\.4(?:\s|$)/i }).click();
      await dialog.getByRole("combobox", { name: /^Review depth/ }).click();
      await page.getByRole("option", { name: /^Medium/ }).click();
      await dialog
        .getByRole("combobox", { name: "Max parallel providers", exact: true })
        .click();
      await page.getByRole("option", { name: "2", exact: true }).click();
      const saveReply = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.request().postData()?.includes("reviewers") === true,
        { timeout: 30000 },
      );
      await dialog
        .getByRole("button", { name: "Save reviewers", exact: true })
        .click();
      await flow.check(
        "roster save returns an acknowledged server action",
        async () => {
          const response = await saveReply;
          const body = await response.text();
          const code = body.match(/"error":"([a-z_]{3,64})"/)?.[1];
          if (code) throw new Error(`roster_save_refused:${code}`);
          expectEqual(response.status(), 200, "server action HTTP status");
          expectEqual(
            body.includes('"status":"saved"'),
            true,
            "server action acknowledged save",
          );
        },
      );
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await flow.check(
        "saved two distinct models/settings and parallelism together",
        async () => {
          const saved = await reader.readPolicyHeads({
            scope: "workspace",
            workspaceId,
          });
          const policy = saved.workspace
            ? parseStoredReviewPolicy("workspace", saved.workspace)
            : null;
          expectEqual(policy?.providers?.length, 2, "reviewer count");
          expectEqual(
            policy?.execution.providerMaxParallel,
            2,
            "parallel reviewers",
          );
          expectEqual(
            policy?.providers?.[1]?.reasoningEffort,
            "medium",
            "second reviewer effort",
          );
          const profiles = await reader.readProviderProfiles({
            workspaceId,
            profileIds: policy?.providers?.map((row) => row.profileId) ?? [],
          });
          expectEqual(
            policy?.providers
              ?.map((row) => profiles.get(row.profileId)?.model)
              .join(","),
            "gpt-5.5,gpt-5.4",
            "models",
          );
        },
      );
      await page.reload();
      dialog = await openDialog(
        page,
        providerListRow(page, VISUAL_PROFILES.gatewayOrg.label).getByRole(
          "button",
          { name: "Review settings", exact: true },
        ),
      );
      await flow.check("reload shows every reviewer", async () => {
        await visible(dialog.getByText(/1\. gpt-5.5/));
        await visible(dialog.getByText(/2\. gpt-5.4/));
      });
      await flow.check(
        "model refresh failure keeps the draft and retry while saving fails closed until recovery",
        async () => {
          await dialog
            .getByRole("button", { name: "Refresh models", exact: true })
            .click();
          await visible(
            dialog.getByText(
              "Could not load account models. Try refreshing the model list. Your saved selection is unchanged.",
              { exact: true },
            ),
          );
          await visible(dialog.getByText(/1\. gpt-5.5/));
          await visible(dialog.getByText(/2\. gpt-5.4/));
          await visible(
            dialog
              .getByText(
                "Model availability could not be checked. Edit this reviewer to refresh account models. Your saved selection is unchanged.",
                { exact: true },
              )
              .first(),
          );
          expectEqual(
            await dialog
              .getByText("This model is unavailable for this account.", {
                exact: false,
              })
              .count(),
            0,
            "a failed catalog is not authoritative model unavailability",
          );
          const save = dialog.getByRole("button", {
            name: "Save reviewers",
            exact: true,
          });
          expectEqual(await save.isDisabled(), true, "catalog admission");
          const retry = dialog.getByRole("button", {
            name: "Refresh models",
            exact: true,
          });
          expectEqual(await retry.isEnabled(), true, "model refresh retry");
          await save.scrollIntoViewIfNeeded();
          await flow.shot(page, "model-refresh-failure-retains-draft");
          await retry.click();
          await visible(dialog.getByText(/^Account model catalog/));
          expectEqual(
            await save.isEnabled(),
            true,
            "recovered catalog admission",
          );
        },
      );
      await flow.shot(page, "two-reviewers-reloaded");
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      for (const width of [1440, 900, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["dark", "light"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await page.evaluate((theme) => {
            localStorage.setItem("reviewrouter-theme", theme);
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.themePreference = theme;
          }, theme);
          await flow.check(
            `roster fits ${width}px in ${theme} theme`,
            async () => {
              expectEqual(
                await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth <= window.innerWidth,
                ),
                true,
                "viewport overflow",
              );
              await dialog
                .getByRole("button", { name: "Save reviewers", exact: true })
                .scrollIntoViewIfNeeded();
              await page.keyboard.press("Tab");
              expectEqual(
                await dialog.evaluate((node) =>
                  node.contains(document.activeElement),
                ),
                true,
                "keyboard focus remains in dialog",
              );
            },
          );
          await flow.shot(page, `roster-${width}-${theme}`);
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await flow.check(
        "roster supports 200 percent text size on narrow mobile",
        async () => {
          const geometry = await dialog.evaluate((node) => ({
            width: node.clientWidth,
            scrollWidth: node.scrollWidth,
            left: node.getBoundingClientRect().left,
            right: node.getBoundingClientRect().right,
            viewport: window.innerWidth,
          }));
          expectEqual(
            geometry.scrollWidth <= geometry.width + 1 &&
              geometry.left >= 0 &&
              geometry.right <= geometry.viewport,
            true,
            `dialog text zoom overflow: ${JSON.stringify(geometry)}`,
          );
        },
      );
      await dialog
        .getByRole("button", { name: "Save reviewers", exact: true })
        .scrollIntoViewIfNeeded();
      await flow.shot(page, "roster-390-light-text-200");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
        document.documentElement.dataset.theme = "dark";
      });
      await page.setViewportSize({ width: 1440, height: 900 });

      const second = await flow.open(
        "admin",
        workspaceRoute("main", "providers"),
      );
      const secondDialog = await openDialog(
        second,
        providerListRow(second, VISUAL_PROFILES.gatewayOrg.label).getByRole(
          "button",
          { name: "Review settings", exact: true },
        ),
      );
      await dialog
        .getByRole("button", { name: "Edit", exact: true })
        .last()
        .click();
      await dialog.getByRole("combobox", { name: /^Review depth/ }).click();
      await page.getByRole("option", { name: /^High/ }).click();
      await dialog
        .getByRole("button", { name: "Save reviewers", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await secondDialog
        .getByRole("button", { name: "Remove", exact: true })
        .nth(1)
        .click();
      await secondDialog
        .getByRole("button", { name: "Save reviewers", exact: true })
        .click();
      await flow.check(
        "stale editor retains its draft and does not overwrite the newer roster",
        async () => {
          await visible(secondDialog.getByRole("alert"));
          await visible(
            secondDialog.getByRole("button", { name: "Reload saved roster" }),
          );
          const saved = await reader.readPolicyHeads({
            scope: "workspace",
            workspaceId,
          });
          const policy = saved.workspace
            ? parseStoredReviewPolicy("workspace", saved.workspace)
            : null;
          expectEqual(policy?.providers?.length, 2, "newer roster count");
          expectEqual(
            policy?.providers?.[1]?.reasoningEffort,
            "high",
            "newer second reviewer effort",
          );
          await visible(secondDialog.getByText(/1\. gpt-5.5/));
        },
      );
      await flow.shot(second, "stale-draft-preserved");
      const repository = VISUAL_REPOSITORIES.mainOwnGateway;
      const repositoryPage = await flow.open(
        "admin",
        repositoryRoute("mainOwnGateway"),
      );
      const repositoryDialog = await openDialog(
        repositoryPage,
        repositorySetupPanel(repositoryPage, "mainOwnGateway").getByRole(
          "button",
          { name: "Change", exact: true },
        ),
      );
      await repositoryDialog
        .getByRole("button", { name: "Use workspace reviewers", exact: true })
        .click();
      await repositoryDialog.waitFor({ state: "hidden" });
      await flow.check(
        "repository inherits the complete workspace roster",
        async () => {
          const stored = await reader.readPolicyHeads({
            scope: "repository",
            workspaceId,
            repositoryId: repository.id,
          });
          const policy = stored.repository
            ? parseStoredReviewPolicy("repository", stored.repository)
            : null;
          expectEqual(
            policy?.providers,
            undefined,
            "repository roster override removed",
          );
          const effective = await new PrismaReviewConfigurationRepository(
            flow.prisma,
            undefined,
            false,
            VISUAL_USERS.admin.id,
          ).findLatest({
            scope: "repository",
            workspaceId,
            repositoryId: repository.id,
          });
          expectEqual(
            effective?.selections.length,
            2,
            "inherited reviewer count",
          );
        },
      );
      await flow.shot(repositoryPage, "repository-inherits-roster");
    },
  },

  {
    id: "flow-step3-create-attach",
    title:
      "Step 3 opens the dialog for the repository; a new provider is attached, listed and not the default; the stepper reaches Ready",
    run: async (flow) => {
      const repositoryKey: VisualRepositoryKey = "mainNeedsSecret";
      const workspace = VISUAL_WORKSPACES.main;
      const repository = VISUAL_REPOSITORIES[repositoryKey];
      const fullName = visualRepositoryFullName(repository);
      const defaultBefore = await defaultProfileId(flow.prisma, workspace.id);
      const page = await flow.open("owner", repositoryRoute(repositoryKey), {
        theme: "light",
      });

      await flow.check("the repository waits on step 3", async () =>
        expectMatch(
          await stepTitle(page, repositoryKey),
          /^3 of 4/,
          "step pill title",
        ),
      );
      const dialog = await openDialog(
        page,
        repositorySetupPanel(page, repositoryKey).getByRole("button", {
          name: "Add secret",
        }),
      );
      await flow.check(
        "the step button opens the one provider dialog fixed to this repository, on its secret",
        async () => {
          await visible(
            dialog.getByRole("heading", { name: `Provider for ${fullName}` }),
          );
          return expectEqual(
            await dialog
              .getByRole("button", { name: "2. Add secret" })
              .getAttribute("aria-current"),
            "step",
            "secret step current",
          );
        },
      );
      await flow.check(
        "Claude token instructions precede storing the token",
        async () => {
          const steps = await dialog.locator("ol li").allTextContents();
          const tokenStep = steps.findIndex((step) =>
            step.includes("claude setup-token"),
          );
          const storeStep = steps.findIndex((step) =>
            /command below|prepared command/i.test(step),
          );
          if (tokenStep < 0 || storeStep <= tokenStep)
            throw new Error(
              "Claude token must be obtained before running its storage command",
            );
          await assertNoHorizontalOverflow(page);
        },
      );
      await flow.shot(page, "step3-dialog");

      await dialog.getByRole("button", { name: "Check GitHub setup" }).click();
      await flow.check(
        "a missing secret does not complete repository setup",
        async () => {
          await visible(dialog.getByText(/is not in the Actions secrets/));
          expectEqual(
            await dialog.getByText("Secret available", { exact: true }).count(),
            0,
            "success badges",
          );
          expectMatch(
            await stepTitle(page, repositoryKey),
            /^3 of 4/,
            "step with missing secret",
          );
        },
      );

      await dialog.getByRole("button", { name: "1. Provider" }).click();
      await chooseNewProvider(dialog);
      await chooseSource(page, dialog, SOURCE.claudeSecret);
      const model =
        getDefaultProviderConfigForAuthMode("claude_code_oauth").model;
      await flow.check(
        "a new provider starts from its default model",
        async () =>
          expectEqual(
            await dialog.getByRole("textbox", { name: "Model" }).inputValue(),
            model,
            "model",
          ),
      );
      await dialog
        .getByRole("button", { name: "Use for this repository" })
        .click();
      await flow.check(
        "saving moves the dialog on to the new provider's secret",
        async () => {
          await expectEventually(async () =>
            expectEqual(
              await dialog
                .getByRole("button", { name: "2. Add secret" })
                .getAttribute("aria-current"),
              "step",
              "secret step current",
            ),
          );
        },
      );

      const created = await flow.prisma.workspaceProviderProfile.findFirst({
        where: {
          workspaceId: workspace.id,
          credentialKind: "user_ci_secret",
          authMode: "claude_code_oauth",
          model,
          archivedAt: null,
        },
      });
      await flow.check(
        "stored: the provider joined the workspace list, added by the owner",
        () => {
          if (!created) throw new Error("no new provider profile");
          return expectEqual(
            created.createdByUserId,
            VISUAL_USERS.owner.id,
            "creator",
          );
        },
      );
      await flow.check(
        "stored: the repository selects the new provider",
        async () =>
          expectEqual(
            await repositoryProfileId(flow.prisma, workspace.id, repository.id),
            created!.id,
            "repository selection",
          ),
      );
      await flow.check(
        "stored: the workspace default did not change",
        async () =>
          expectEqual(
            await defaultProfileId(flow.prisma, workspace.id),
            defaultBefore,
            "workspace default",
          ),
      );

      // The user adds the secret on GitHub, then checks its availability here.
      await flow.env.writeGitHubState({
        repositorySecrets: [
          ...flow.seed.github.repositorySecrets,
          visualRepositorySecretKey(fullName, "CLAUDE_CODE_OAUTH_TOKEN"),
        ],
      });
      await dialog.getByRole("button", { name: "Check GitHub setup" }).click();
      await flow.check("the secret check passes against GitHub", async () => {
        await visible(
          dialog.getByText(`CLAUDE_CODE_OAUTH_TOKEN is set for ${fullName}.`),
        );
      });
      await flow.check(
        "returning to the current repository performs a fresh server read and closes setup",
        () => returnFromSetupDialog(page, dialog, "Back to repository setup"),
      );
      await flow.check(
        "returning reloads the same repository and preserves confirmed readiness",
        async () => {
          await assertRepositoryExpanded(page, repositoryKey);
          await expectEventually(async () =>
            expectMatch(
              await stepTitle(page, repositoryKey),
              /^4 of 4/,
              "step pill title",
            ),
          );
        },
      );
      await flow.check("the provider line names the new provider", async () => {
        await visible(
          repositorySetupPanel(page, repositoryKey).getByText(
            `Provider: ${created!.label}`,
            { exact: true },
          ),
        );
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await flow.check("the ready repository remains usable on mobile", () =>
        assertNoHorizontalOverflow(page),
      );
      await repositorySetupPanel(page, repositoryKey).scrollIntoViewIfNeeded();
      await flow.shot(page, "stepper-ready");

      await gotoDashboard(page, workspaceRoute("main", "providers"));
      const row = providerListRow(page, created!.label);
      await flow.check(
        "the Providers list shows it, used by the repository, without the Default badge",
        async () => {
          await visible(row.getByText(fullName));
          return expectEqual(
            await row.getByText("Default", { exact: true }).count(),
            0,
            "Default badges on the new provider",
          );
        },
      );
    },
  },
  {
    id: "flow-default-inherited",
    title:
      "An admin makes a member's provider the default; repositories without their own provider inherit it",
    run: async (flow) => {
      const workspace = VISUAL_WORKSPACES.main;
      const profile = VISUAL_PROFILES.memberMimo;
      const profileId = requiredProfile(flow.seed, "memberMimo");
      const page = await flow.open(
        "admin",
        workspaceRoute("main", "providers"),
      );
      const dialog = await openDialog(
        page,
        providerListRow(page, profile.label).getByRole("button", {
          name: "Make default",
        }),
      );
      await flow.check("the dialog opens with that provider chosen", async () =>
        expectEqual(
          await dialog
            .getByRole("radio", {
              name: new RegExp(escapeRegExp(profile.label)),
            })
            .getAttribute("aria-checked"),
          "true",
          "radio checked",
        ),
      );
      await dialog.getByRole("button", { name: "Set as default" }).click();
      await dialog
        .getByRole("link", { name: "Finish repository setup" })
        .waitFor();
      await page.getByRole("button", { name: "Close provider setup" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30_000 });
      await flow.check(
        "stored: the workspace default is that provider",
        async () =>
          expectEqual(
            await defaultProfileId(flow.prisma, workspace.id),
            profileId,
            "workspace default",
          ),
      );
      await flow.check("the list moves the Default badge to it", async () => {
        await visible(
          providerListRow(page, profile.label).getByText("Default", {
            exact: true,
          }),
        );
      });
      await flow.shot(page, "providers-new-default");

      await gotoDashboard(page, workspaceRoute("main", "repositories"));
      await flow.check(
        "a repository without its own provider shows the new default in its row",
        async () => {
          await visible(
            repositoryRowHeader(page, "mainSetupPr").getByText(
              `Default: ${profile.label}`,
            ),
          );
        },
      );
      await gotoDashboard(page, repositoryRoute("mainSetupPr"));
      await flow.check(
        "the line above its steps says it uses the workspace default",
        async () => {
          await visible(
            repositorySetupPanel(page, "mainSetupPr").getByText(
              `Using workspace default: ${profile.label}`,
            ),
          );
        },
      );
      await flow.check(
        "a repository with its own provider keeps it",
        async () => {
          await visible(
            repositoryRowHeader(page, "mainOwnGateway").getByText(
              VISUAL_PROFILES.gatewayOrg.label,
              { exact: true },
            ),
          );
        },
      );
      await flow.shot(page, "repository-inherits");
    },
  },
  {
    id: "flow-model-edit-everywhere",
    title:
      "Editing the default's model in place changes what every user sees wherever it is used",
    run: async (flow) => {
      const profile = VISUAL_PROFILES.claudeDefault;
      const profileId = requiredProfile(flow.seed, "claudeDefault");
      const nextModel = "opus";
      const page = await flow.open(
        "owner",
        workspaceRoute("main", "providers"),
      );
      const dialog = await openDialog(
        page,
        providerListRow(page, profile.label).getByRole("button", {
          name: "Edit",
        }),
      );
      await flow.check(
        "the edit says the change applies everywhere",
        async () => {
          await visible(
            dialog.getByText(/applies at once to the workspace default/),
          );
        },
      );
      await chooseModel(dialog, nextModel);
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30_000 });
      await flow.check("stored: the provider has the new model", async () => {
        const stored = await flow.prisma.workspaceProviderProfile.findUnique({
          where: { id: profileId },
          select: { model: true, label: true },
        });
        expectEqual(stored?.model, nextModel, "model");
        return expectEqual(stored?.label, profile.label, "custom label kept");
      });
      await flow.check("the list row shows the new model", async () => {
        await visible(
          providerListRow(page, profile.label).getByText(nextModel, {
            exact: true,
          }),
        );
      });
      await gotoDashboard(page, repositoryRoute("mainNeedsSecret"));
      await flow.check(
        "an inheriting repository's line shows the new model",
        async () =>
          expectMatch(
            await repositorySetupPanel(page, "mainNeedsSecret")
              .getByText(/^Claude Code · GitHub Secrets/)
              .first()
              .innerText(),
            new RegExp(`· ${nextModel}$`),
            "provider line detail",
          ),
      );
      await gotoDashboard(page, workspaceRoute("main", "policy"));
      await flow.check(
        "the Model section's default line shows it",
        async () => {
          await visible(page.getByText(new RegExp(`· ${nextModel}$`)));
        },
      );
      const member = await flow.open("member", repositoryRoute("mainReady"));
      await flow.check("the member sees the new model too", async () =>
        expectMatch(
          await repositorySetupPanel(member, "mainReady")
            .getByText(/^Claude Code · GitHub Secrets/)
            .first()
            .innerText(),
          new RegExp(`· ${nextModel}$`),
          "provider line detail",
        ),
      );
      await flow.shot(member, "member-sees-model");
    },
  },
  {
    id: "flow-member-create-not-edit-foreign",
    title:
      "A member maintainer creates and attaches a provider, but cannot change one someone else added",
    run: async (flow) => {
      const workspace = VISUAL_WORKSPACES.main;
      const repositoryKey: VisualRepositoryKey = "mainNeedsSecret";
      const repository = VISUAL_REPOSITORIES[repositoryKey];
      const defaultBefore = await defaultProfileId(flow.prisma, workspace.id);
      const page = await flow.open("member", repositoryRoute(repositoryKey));
      const dialog = await openDialog(
        page,
        repositorySetupPanel(page, repositoryKey).getByRole("button", {
          name: "Use a different provider",
        }),
      );
      await chooseNewProvider(dialog);
      await chooseSource(page, dialog, SOURCE.claudeSecret);
      await chooseModel(dialog, "haiku");
      await dialog
        .getByRole("button", { name: "Use for this repository" })
        .click();
      await flow.check("saving moves on to the secret step", async () =>
        expectEventually(async () =>
          expectEqual(
            await dialog
              .getByRole("button", { name: "2. Add secret" })
              .getAttribute("aria-current"),
            "step",
            "secret step current",
          ),
        ),
      );
      const created = await flow.prisma.workspaceProviderProfile.findFirst({
        where: {
          workspaceId: workspace.id,
          authMode: "claude_code_oauth",
          model: "haiku",
          archivedAt: null,
        },
      });
      await flow.check("stored: the member added the provider", () => {
        if (!created) throw new Error("no new provider profile");
        return expectEqual(
          created.createdByUserId,
          VISUAL_USERS.member.id,
          "creator",
        );
      });
      await flow.check("stored: the repository selects it", async () =>
        expectEqual(
          await repositoryProfileId(flow.prisma, workspace.id, repository.id),
          created!.id,
          "repository selection",
        ),
      );
      await flow.check("stored: the default did not change", async () =>
        expectEqual(
          await defaultProfileId(flow.prisma, workspace.id),
          defaultBefore,
          "workspace default",
        ),
      );
      await page.getByRole("button", { name: "Close provider setup" }).click();

      await gotoDashboard(page, workspaceRoute("main", "providers"));
      const own = providerListRow(page, created!.label);
      const foreign = providerListRow(
        page,
        VISUAL_PROFILES.claudeDefault.label,
      );
      await flow.check(
        "the member can edit the provider they added",
        async () =>
          expectEqual(
            await own.getByRole("button", { name: "Edit" }).isEnabled(),
            true,
            "Edit enabled",
          ),
      );
      await flow.check(
        "the member cannot edit or remove the owner's provider, and is told why",
        async () => {
          expectEqual(
            await foreign.getByRole("button", { name: "Edit" }).count(),
            0,
            "Edit buttons",
          );
          expectEqual(
            await foreign
              .getByRole("button", { name: "Remove", exact: true })
              .count(),
            0,
            "Remove buttons",
          );
          await visible(
            page.getByText("You can edit or remove the providers you added."),
          );
        },
      );
      await flow.shot(page, "member-providers");
      await flow.check(
        "stored: the write refuses the member's rename of the owner's provider",
        async () => {
          try {
            await renameWorkspaceProviderProfile(
              {
                workspaceId: workspace.id,
                profileId: requiredProfile(flow.seed, "claudeDefault"),
                actor: actorOf("member"),
                label: "Renamed by member",
              },
              { profiles: profileRepository(flow.prisma) },
            );
          } catch (error) {
            if (error instanceof ProviderManagementDeniedError)
              return expectEqual(
                error.reason,
                "profile_creator_required",
                "denial reason",
              );
            throw error;
          }
          throw new Error("the rename was accepted");
        },
      );
    },
  },
  {
    id: "flow-access-rights",
    title:
      "Access rights on: members lose provider management, owners and admins keep it",
    run: async (flow) => {
      const workspace = VISUAL_WORKSPACES.main;
      const admin = await flow.open("admin", workspaceRoute("main", "other"));
      const toggle = admin.getByRole("checkbox", {
        name: /Only owners and admins manage providers/,
      });
      await toggle.check();
      await admin.getByRole("button", { name: "Save access rights" }).click();
      await flow.check("stored: Access rights are on", async () =>
        expectEventually(async () => {
          const stored = await flow.prisma.workspace.findUnique({
            where: { id: workspace.id },
            select: { providerManagementAdminOnly: true },
          });
          return expectEqual(
            stored?.providerManagementAdminOnly,
            true,
            "providerManagementAdminOnly",
          );
        }),
      );
      await flow.shot(admin, "admin-saved");

      const member = await flow.open(
        "member",
        workspaceRoute("main", "providers"),
      );
      await flow.check(
        "the member's list says why it is read-only",
        async () => {
          await visible(
            member.getByText(
              "Only workspace owners and admins can manage providers.",
            ),
          );
          expectEqual(
            await member
              .getByRole("button", { name: "Add provider" })
              .isEnabled(),
            false,
            "Add provider enabled",
          );
          return expectEqual(
            await providerListRow(member, VISUAL_PROFILES.memberMimo.label)
              .getByRole("button", { name: "Edit" })
              .count(),
            0,
            "Edit buttons on the member's own provider",
          );
        },
      );
      await flow.shot(member, "member-list");
      await gotoDashboard(member, repositoryRoute("mainNeedsSecret"));
      const dialog = await openDialog(
        member,
        repositorySetupPanel(member, "mainNeedsSecret").getByRole("button", {
          name: "Use a different provider",
        }),
      );
      await flow.check(
        "the member's dialog disables every choice with the reason",
        async () => {
          await visible(
            dialog
              .getByText(
                "Only workspace owners and admins can manage providers.",
              )
              .first(),
          );
          const radios = await dialog.getByRole("radio").all();
          const enabled: string[] = [];
          for (const radio of radios)
            if (!(await radio.isDisabled()))
              enabled.push((await radio.getAttribute("aria-labelledby")) ?? "");
          if (radios.length === 0) throw new Error("no choices shown");
          return expectEqual(
            enabled.length,
            0,
            `enabled choices of ${radios.length}`,
          );
        },
      );
      await flow.shot(member, "member-dialog");
      await flow.check(
        "stored: the write refuses the member's attach",
        async () => {
          const [result] = await assignProviderProfileToRepositories(
            {
              workspaceId: workspace.id,
              actor: actorOf("member"),
              profileId: requiredProfile(flow.seed, "memberMimo"),
              settings: VISUAL_SELECTION_SETTINGS,
              repositories: [
                {
                  repositoryId: VISUAL_REPOSITORIES.mainNeedsSecret.id,
                  capability: "direct_config",
                },
              ],
            },
            selectionDependencies(flow.prisma, "member"),
          );
          if (result?.status !== "denied")
            throw new Error(`attach result ${JSON.stringify(result)}`);
          return expectEqual(
            result.reason,
            "access_rights_admin_only",
            "reason",
          );
        },
      );
      const owner = await flow.open(
        "owner",
        workspaceRoute("main", "providers"),
      );
      await flow.check("the owner still manages providers", async () => {
        expectEqual(
          await owner.getByRole("button", { name: "Add provider" }).isEnabled(),
          true,
          "Add provider enabled",
        );
        return expectEqual(
          await providerListRow(owner, VISUAL_PROFILES.memberMimo.label)
            .getByRole("button", { name: "Edit" })
            .isEnabled(),
          true,
          "Edit of a member's provider enabled",
        );
      });
      await gotoDashboard(member, workspaceRoute("main", "other"));
      await flow.check(
        "the member sees the setting on and disabled",
        async () => {
          const memberToggle = member.getByRole("checkbox", {
            name: /Only owners and admins manage providers/,
          });
          expectEqual(await memberToggle.isChecked(), true, "checked");
          return expectEqual(await memberToggle.isDisabled(), true, "disabled");
        },
      );
    },
  },
  {
    id: "flow-remove-used-refused",
    title:
      "Removing a provider in use is refused with the repositories that use it",
    run: async (flow) => {
      const workspace = VISUAL_WORKSPACES.main;
      const owner = await flow.open(
        "owner",
        workspaceRoute("main", "providers"),
      );
      const used = providerListRow(owner, VISUAL_PROFILES.claudeDefault.label);
      await flow.check(
        "Remove of the default is disabled with the reason",
        async () => {
          expectEqual(
            await used
              .getByRole("button", { name: "Remove", exact: true })
              .isEnabled(),
            false,
            "Remove enabled",
          );
          await visible(
            used.getByText(
              "To remove it, first choose another provider wherever it is used.",
            ),
          );
        },
      );

      // A repository starts using it while the admin's confirmation is open.
      const profile = VISUAL_PROFILES.gatewayPersonal;
      const profileId = requiredProfile(flow.seed, "gatewayPersonal");
      const admin = await flow.open(
        "admin",
        workspaceRoute("main", "providers"),
      );
      const confirm = await openDialog(
        admin,
        providerListRow(admin, profile.label).getByRole("button", {
          name: "Remove",
          exact: true,
        }),
      );
      const [attached] = await assignProviderProfileToRepositories(
        {
          workspaceId: workspace.id,
          actor: actorOf("admin"),
          profileId,
          settings: VISUAL_SELECTION_SETTINGS,
          repositories: [
            {
              repositoryId: VISUAL_REPOSITORIES.mainSetupPr.id,
              capability: "direct_config",
            },
          ],
        },
        selectionDependencies(flow.prisma, "admin"),
      );
      await flow.check("meanwhile a repository chose it", () =>
        expectEqual(attached?.status, "applied", "attach"),
      );
      await confirm.getByRole("button", { name: "Remove provider" }).click();
      const fullName = visualRepositoryFullName(
        VISUAL_REPOSITORIES.mainSetupPr,
      );
      await flow.check(
        "the removal is refused naming the repository",
        async () => {
          const alert = confirm.getByRole("alert");
          await visible(alert);
          return expectMatch(
            await alert.innerText(),
            new RegExp(escapeRegExp(fullName)),
            "refusal",
          );
        },
      );
      await flow.shot(admin, "remove-refused");
      await flow.check(
        "stored: the provider is still in the list",
        async () => {
          const stored = await flow.prisma.workspaceProviderProfile.findUnique({
            where: { id: profileId },
            select: { archivedAt: true },
          });
          return expectEqual(stored?.archivedAt ?? null, null, "archivedAt");
        },
      );
    },
  },
  {
    id: "flow-member-gateway-attach",
    title:
      "With personal account sharing off, a member maintainer attaches a workspace Gateway provider",
    requires: { personalSharing: false },
    run: async (flow) => {
      const workspace = VISUAL_WORKSPACES.main;
      const repository = VISUAL_REPOSITORIES.mainNeedsSecret;
      const profile = VISUAL_PROFILES.gatewayOrg;
      const page = await flow.open(
        "member",
        repositoryRoute("mainNeedsSecret"),
      );
      const dialog = await openDialog(
        page,
        repositorySetupPanel(page, "mainNeedsSecret").getByRole("button", {
          name: "Use a different provider",
        }),
      );
      await chooseCard(dialog, profile.label);
      await dialog
        .getByRole("button", { name: "Use for this repository" })
        .click();
      await flow.check(
        "the dialog closes: a Gateway provider needs no credential step",
        async () => {
          await dialog.waitFor({ state: "hidden", timeout: 30_000 });
        },
      );
      await flow.check(
        "stored: the repository selects the Gateway provider",
        async () =>
          expectEqual(
            await repositoryProfileId(flow.prisma, workspace.id, repository.id),
            requiredProfile(flow.seed, "gatewayOrg"),
            "repository selection",
          ),
      );
      await flow.check("the provider line names it", async () => {
        await visible(
          repositorySetupPanel(page, "mainNeedsSecret").getByText(
            `Provider: ${profile.label}`,
            { exact: true },
          ),
        );
      });
      await flow.shot(page, "member-gateway-attached");
    },
  },
  {
    id: "flow-codex-repository-setup",
    title:
      "Codex stays inside repository setup; viewing and checking do not issue commands; deadline and recovery require explicit actions",
    requires: { rotating: true },
    run: async (flow) => {
      const key: VisualRepositoryKey = "mainRotating";
      const repository = VISUAL_REPOSITORIES[key];
      const page = await flow.open("owner", repositoryRoute(key));
      await page.clock.install({ time: new Date() });
      let issued = 0;
      let checked = 0;
      const recoveryIds: string[] = [];
      // Only these two existing UI adapter endpoints are controlled. The
      // session, repository reads and confirmation endpoint remain real.
      const fixtureCommand =
        "printf '%s\\n' 'Codex setup UI fixture; no credentials'";
      const recoveredCommand =
        "printf '%s\\n' 'Codex recovery UI fixture; no credentials'";
      const commandResponse = async (command: string) => ({
        command,
        expiresAt: new Date(
          (await page.evaluate(() => Date.now())) + 15 * 60_000,
        ).toISOString(),
        providerInstanceId: `codex-rotating:${repository.githubRepositoryId}`,
      });
      await page.route(
        "**/api/dashboard/codex-rotating/setup-command",
        async (route) => {
          const form = await browserRequestForm(route.request());
          expectEqual(
            form.get("workspaceId"),
            VISUAL_WORKSPACES.main.id,
            "command workspace",
          );
          expectEqual(
            form.get("repositoryId"),
            repository.id,
            "command repository",
          );
          issued += 1;
          await route.fulfill({
            status: issued <= 2 ? 200 : 409,
            json:
              issued <= 2
                ? await commandResponse(fixtureCommand)
                : { error: "codex_rotating_setup_recovery_required" },
          });
        },
      );
      await page.route(
        "**/api/dashboard/codex-rotating/setup-recovery",
        async (route) => {
          const form = await browserRequestForm(route.request());
          expectEqual(
            form.get("workspaceId"),
            VISUAL_WORKSPACES.main.id,
            "recovery workspace",
          );
          expectEqual(
            form.get("repositoryId"),
            repository.id,
            "recovery repository",
          );
          expectEqual(
            form.get("acknowledgement"),
            "all_prior_installers_and_writers_are_stopped",
            "explicit recovery acknowledgement",
          );
          const requestId = form.get("recoveryRequestId");
          if (typeof requestId !== "string" || requestId.length === 0)
            throw new Error("recovery request identity missing");
          recoveryIds.push(requestId);
          if (recoveryIds.length === 1) return route.abort("failed");
          await route.fulfill({
            json: await commandResponse(recoveredCommand),
          });
        },
      );
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname ===
          "/api/dashboard/provider-secret-setup/confirm"
        )
          checked += 1;
      });
      const open = () =>
        openDialog(
          page,
          repositorySetupPanel(page, key)
            .getByRole("button", { name: "Connect Codex", exact: true })
            .first(),
        );
      let dialog = await open();
      await flow.check(
        "opening Codex is read-only and shows a direct check action",
        async () => {
          await visible(
            dialog.getByRole("button", {
              name: "Get setup command",
              exact: true,
            }),
          );
          await visible(
            dialog.getByRole("button", {
              name: "Check GitHub setup",
              exact: true,
            }),
          );
          expectEqual(checked, 0, "no automatic confirmation");
          expectEqual(issued, 0, "issued commands");
          expectEqual(recoveryIds.length, 0, "recovery requests");
          await assertNoHorizontalOverflow(page);
        },
      );
      await flow.shot(page, "codex-initial");

      const confirmation = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/dashboard/provider-secret-setup/confirm" &&
          response.request().method() === "POST",
        { timeout: 90_000 },
      );
      await dialog
        .getByRole("button", { name: "Check GitHub setup", exact: true })
        .click();
      const verification = (await (await confirmation).json()) as {
        params?: Record<string, string>;
      };
      await flow.check(
        "the real unprepared setup refuses verification without issuing a credential",
        async () => {
          expectMatch(
            verification.params?.error,
            /^codex_rotating_(?:setup_not_ready|workflow_namespace_not_ready)$/,
            "real confirmation refusal",
          );
          await visible(dialog.getByRole("alert"));
          expectEqual(checked, 1, "checks without issuance");
          expectEqual(issued, 0, "issued commands");
          expectEqual(
            await dialog.getByText("Setup verified", { exact: true }).count(),
            0,
            "success states",
          );
          expectEqual(
            /^4 of 4/.test((await stepTitle(page, key)) ?? ""),
            false,
            "repository ready",
          );
        },
      );
      await dialog
        .getByRole("button", { name: "Get setup command", exact: true })
        .click();
      await visible(dialog.getByText(fixtureCommand, { exact: true }));
      await flow.check(
        "a command is issued once only after an explicit click",
        async () => {
          expectEqual(issued, 1, "issued commands");
          await visible(dialog.getByText(/Start this command by/));
        },
      );
      await flow.shot(page, "codex-issued");
      await page.getByRole("button", { name: "Close provider setup" }).click();
      dialog = await open();
      await flow.check(
        "reopening clears the one-time command and does not issue again",
        async () => {
          await visible(
            dialog.getByRole("button", {
              name: "Get setup command",
              exact: true,
            }),
          );
          expectEqual(issued, 1, "issued commands after reopen");
          expectEqual(
            await dialog.getByText(fixtureCommand, { exact: true }).count(),
            0,
            "retained command text",
          );
        },
      );
      await dialog
        .getByRole("button", { name: "Get setup command", exact: true })
        .click();
      await visible(dialog.getByText(fixtureCommand, { exact: true }));
      await page.clock.fastForward(16 * 60_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await flow.check(
        "the start deadline explains both cases without renewing or cancelling",
        async () => {
          await visible(dialog.getByText(/The start deadline has passed/));
          expectEqual(issued, 2, "no automatic issuance at expiry");
          expectEqual(recoveryIds.length, 0, "no automatic recovery");
          await assertNoHorizontalOverflow(page);
        },
      );
      await dialog
        .getByText(/The start deadline has passed/)
        .scrollIntoViewIfNeeded();
      await flow.shot(page, "codex-deadline-mobile");
      await dialog
        .getByRole("button", { name: "Get a fresh command", exact: true })
        .click();
      const acknowledgement = dialog.getByRole("checkbox", {
        name: /I confirm every earlier installer and review run is stopped/,
      });
      const recover = dialog.getByRole("button", {
        name: "Recover and get a setup command",
        exact: true,
      });
      await flow.check(
        "a fetched command enters explicit recovery instead of pretending renewal succeeded",
        async () => {
          await visible(acknowledgement);
          expectEqual(
            await acknowledgement.isChecked(),
            false,
            "recovery opt-in",
          );
          expectEqual(
            await recover.isDisabled(),
            true,
            "recovery disabled until acknowledgement",
          );
          expectEqual(issued, 3, "requested commands");
          expectEqual(recoveryIds.length, 0, "recovery requests");
        },
      );
      await recover.scrollIntoViewIfNeeded();
      await flow.shot(page, "codex-recovery-mobile");
      await acknowledgement.check();
      await recover.click();
      await visible(
        dialog.getByRole("button", { name: "Retry recovery", exact: true }),
      );
      await flow.check(
        "an unknown network outcome retains the recovery operation",
        async () => {
          expectEqual(recoveryIds.length, 1, "no automatic retry");
          expectEqual(issued, 3, "no replacement issuance");
          expectEqual(
            await acknowledgement.isChecked(),
            true,
            "explicit acknowledgement retained",
          );
        },
      );
      await dialog
        .getByRole("button", { name: "Retry recovery", exact: true })
        .click();
      await visible(dialog.getByText(recoveredCommand, { exact: true }));
      await flow.check(
        "retrying recovery preserves its request identity and never claims activation",
        async () => {
          expectEqual(recoveryIds.length, 2, "explicit recovery attempts");
          expectEqual(
            recoveryIds[0],
            recoveryIds[1],
            "recovery request identity",
          );
          expectEqual(
            await dialog.getByText("Setup verified", { exact: true }).count(),
            0,
            "no synthetic activation",
          );
        },
      );
      await flow.check(
        "the Codex return to the current repository performs a fresh server read and closes setup",
        () => returnFromSetupDialog(page, dialog, "Back to repository setup"),
      );
      await flow.check(
        "returning reveals the same repository with authoritative incomplete setup",
        async () => {
          await assertRepositoryExpanded(page, key);
          expectEqual(
            /^4 of 4/.test((await stepTitle(page, key)) ?? ""),
            false,
            "not a live activation proof",
          );
          expectEqual(issued, 3, "no issuance on return");
          expectEqual(checked, 1, "only the explicit confirmation request");
          expectEqual(recoveryIds.length, 2, "only explicit recovery attempts");
          await assertNoHorizontalOverflow(page);
        },
      );
      await repositorySetupPanel(page, key).scrollIntoViewIfNeeded();
      await flow.shot(page, "codex-return-mobile");
    },
  },
  {
    id: "flow-no-default",
    title:
      "Without a default the table stays visible with the banner; choosing a default lets repositories inherit it",
    run: async (flow) => {
      const workspace = VISUAL_WORKSPACES.empty;
      const member = await flow.open(
        "member",
        workspaceRoute("empty", "repositories"),
      );
      await flow.check(
        "a member sees the table and who sets a default",
        async () => {
          await visible(
            member.getByText(/This workspace has no default provider/),
          );
          await visible(repositoryRow(member, "emptyFirst"));
          await visible(repositoryRow(member, "emptyConfigured"));
        },
      );
      const owner = await flow.open(
        "owner",
        workspaceRoute("empty", "repositories", { workspace: workspace.id }),
        { width: 390, theme: "light" },
      );
      await flow.check(
        "the owner sees the banner, the action and every row",
        async () => {
          await visible(
            owner.getByText("No default provider", { exact: true }),
          );
          await visible(
            repositoryRowHeader(owner, "emptyFirst").getByText(
              "No provider yet",
            ),
          );
          await visible(
            repositoryRowHeader(owner, "emptyConfigured").getByText(
              "No provider yet",
            ),
          );
        },
      );
      const dialog = await openDialog(
        owner,
        owner.getByRole("button", { name: "Choose default provider" }),
      );
      await chooseNewProvider(dialog);
      await chooseSource(owner, dialog, SOURCE.claudeSecret);
      await dialog.getByRole("button", { name: "Set as default" }).click();
      const finish = dialog.getByRole("link", {
        name: "Finish repository setup",
      });
      await flow.check(
        "saving the default shows the next step, not a ready repository",
        async () => {
          await visible(finish);
          const target = new URL(
            (await finish.getAttribute("href"))!,
            flow.env.appUrl,
          );
          expectEqual(
            target.searchParams.get("section"),
            "repositories",
            "next section",
          );
          expectEqual(
            target.searchParams.get("workspace"),
            workspace.id,
            "next workspace",
          );
          expectEqual(
            target.searchParams.has("repository"),
            false,
            "no invented repository target",
          );
          await assertNoHorizontalOverflow(owner);
        },
      );
      await flow.shot(owner, "default-saved-next-step");
      const profile = await flow.prisma.workspaceProviderProfile.findFirst({
        where: { workspaceId: workspace.id, archivedAt: null },
      });
      await flow.check("stored: the new provider is the default", async () => {
        if (!profile) throw new Error("no provider profile");
        return expectEqual(
          await defaultProfileId(flow.prisma, workspace.id),
          profile.id,
          "workspace default",
        );
      });
      await flow.check(
        "the workspace next step rereads the current repository list and closes setup",
        () => returnFromSetupDialog(owner, dialog, "Finish repository setup"),
      );
      await flow.check(
        "the banner is gone and the rows inherit the default",
        async () => {
          await expectEventually(async () =>
            expectEqual(
              await owner
                .getByText("No default provider", { exact: true })
                .count(),
              0,
              "banners",
            ),
          );
          await visible(
            repositoryRowHeader(owner, "emptyFirst").getByText(
              `Default: ${profile!.label}`,
            ),
          );
        },
      );
      await gotoDashboard(owner, repositoryRoute("emptyFirst"));
      const setup = repositorySetupPanel(owner, "emptyFirst");
      const secretDialog = await openDialog(
        owner,
        setup.getByRole("button", { name: "Use a different provider" }),
      );
      await secretDialog.getByRole("button", { name: "2. Add secret" }).click();
      const unprepared = VISUAL_REPOSITORIES.emptyFirst;
      const unpreparedFullName = visualRepositoryFullName(unprepared);
      await flow.env.writeGitHubState({
        repositorySecrets: [
          ...flow.seed.github.repositorySecrets,
          visualRepositorySecretKey(
            unpreparedFullName,
            "CLAUDE_CODE_OAUTH_TOKEN",
          ),
        ],
      });
      await secretDialog
        .getByRole("button", { name: "Check GitHub setup" })
        .click();
      await flow.check(
        "a confirmed secret before workflow setup does not turn the repository green",
        async () => {
          await visible(
            secretDialog.getByText("Secret available", { exact: true }),
          );
          expectMatch(
            await stepTitle(owner, "emptyFirst"),
            /^1 of 4/,
            "workflow prerequisite remains",
          );
        },
      );
      await flow.check(
        "returning before workflow setup also performs a fresh server read",
        () =>
          returnFromSetupDialog(
            owner,
            secretDialog,
            "Back to repository setup",
          ),
      );
      await flow.check(
        "the same pending workflow step survives a server reload",
        async () => {
          await assertRepositoryExpanded(owner, "emptyFirst");
          await expectEventually(async () =>
            expectMatch(
              await stepTitle(owner, "emptyFirst"),
              /^1 of 4/,
              "authoritative step",
            ),
          );
          expectEqual(
            await repositoryProfileId(flow.prisma, workspace.id, unprepared.id),
            null,
            "workspace inheritance preserved",
          );
          expectEqual(
            await defaultProfileId(flow.prisma, workspace.id),
            profile!.id,
            "default preserved",
          );
        },
      );
    },
  },
];

const fixtureValidator: EffectiveReviewConfigurationValidatorPort = {
  validate: async () => undefined,
};

function actorOf(user: VisualUserKey) {
  return {
    userId: VISUAL_USERS[user].id,
    auditActor: `user:github:${VISUAL_USERS[user].login}`,
  };
}

function profileRepository(prisma: PrismaClient) {
  return new PrismaWorkspaceProviderProfileRepository(prisma, {
    operatorWorkspaceId: undefined,
    personalAccountsEnabled: true,
  });
}

/** A write as the user, without the network checks the fixture lacks. */
function selectionDependencies(prisma: PrismaClient, user: VisualUserKey) {
  return {
    configurations: new PrismaReviewConfigurationRepository(
      prisma,
      undefined,
      true,
      VISUAL_USERS[user].id,
    ),
    policyHeads: new PrismaReviewPolicyHeadReader(prisma),
    validator: fixtureValidator,
  };
}

async function defaultProfileId(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<string | null> {
  const heads = await new PrismaReviewPolicyHeadReader(prisma).readPolicyHeads({
    scope: "workspace",
    workspaceId,
  });
  return heads.workspace
    ? (parseStoredReviewPolicy("workspace", heads.workspace)?.providers?.[0]
        ?.profileId ?? null)
    : null;
}

async function repositoryProfileId(
  prisma: PrismaClient,
  workspaceId: string,
  repositoryId: string,
): Promise<string | null> {
  const heads = await new PrismaReviewPolicyHeadReader(prisma).readPolicyHeads({
    scope: "repository",
    workspaceId,
    repositoryId,
  });
  return heads.repository
    ? (parseStoredReviewPolicy("repository", heads.repository)?.providers?.[0]
        ?.profileId ?? null)
    : null;
}

function requiredProfile(
  seed: VisualSeedResult,
  key: VisualProfileKey,
): string {
  const id = seed.profileIds[key];
  if (!id) throw new Error(`provider_visual_profile_missing:${key}`);
  return id;
}

function repositoryRow(page: Page, key: VisualRepositoryKey): Locator {
  return page.locator(
    `[data-repository-row-id="${VISUAL_REPOSITORIES[key].id}"]`,
  );
}

async function stepTitle(
  page: Page,
  key: VisualRepositoryKey,
): Promise<string | null> {
  return (await repositoryStepPill(page, key)).getAttribute("title");
}

async function visible(locator: Locator, timeout = 30_000): Promise<void> {
  await locator.first().waitFor({ state: "visible", timeout });
}

/** A fragment-only link must still fetch the authoritative dashboard again. */
async function returnFromSetupDialog(
  page: Page,
  dialog: Locator,
  linkName: string,
): Promise<string> {
  const link = dialog.getByRole("link", { name: linkName, exact: true });
  const target = new URL((await link.getAttribute("href"))!, page.url());
  const current = new URL(page.url());
  expectEqual(
    `${current.origin}${current.pathname}${current.search}`,
    `${target.origin}${target.pathname}${target.search}`,
    "same dashboard route before returning",
  );
  await Promise.all([
    page.waitForResponse(
      (response) => {
        const request = response.request();
        const url = new URL(response.url());
        return (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          request.method() === "GET" &&
          url.origin === target.origin &&
          url.pathname === target.pathname &&
          url.search === target.search &&
          response.status() === 200
        );
      },
      { timeout: 90_000 },
    ),
    link.click(),
  ]);
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  return "fresh dashboard document 200; provider dialog closed";
}

async function assertRepositoryExpanded(
  page: Page,
  key: VisualRepositoryKey,
): Promise<void> {
  const repository = VISUAL_REPOSITORIES[key];
  const url = new URL(page.url());
  expectEqual(
    url.searchParams.get("repository"),
    visualRepositoryFullName(repository),
    "returned repository",
  );
  expectEqual(
    url.searchParams.get("workspace"),
    VISUAL_WORKSPACES[repository.workspace].id,
    "returned workspace",
  );
  await visible(repositorySetupPanel(page, key));
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expectEqual(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "horizontal overflow absent",
  );
}

/** Only synthetic command/recovery form fields; never read browser cookies. */
async function browserRequestForm(request: BrowserRequest): Promise<FormData> {
  expectEqual(request.method(), "POST", "command action method");
  return new Request(request.url(), {
    method: "POST",
    headers: { "content-type": request.headers()["content-type"] ?? "" },
    body: request.postData() ?? "",
  }).formData();
}

function expectEqual<Value>(
  actual: Value,
  expected: Value,
  what: string,
): string {
  if (actual !== expected)
    throw new Error(
      `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  return `${what} = ${JSON.stringify(actual)}`;
}

function expectMatch(
  actual: string | null | undefined,
  pattern: RegExp,
  what: string,
): string {
  if (!actual || !pattern.test(actual))
    throw new Error(
      `${what}: ${JSON.stringify(actual)} does not match ${pattern}`,
    );
  return `${what} = ${JSON.stringify(actual)}`;
}

/** Retries a check until it passes, for state the page refreshes on its own. */
async function expectEventually<Result>(
  check: () => Promise<Result>,
  timeout = 30_000,
): Promise<Result> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? (error.message.split("\n")[0] ?? error.message)
    : String(error);
}
