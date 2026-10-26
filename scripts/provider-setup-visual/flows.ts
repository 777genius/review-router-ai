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
import type { Browser, Locator, Page } from "playwright-core";
import {
  assignProviderProfileToRepositories,
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
    const record: FlowRecord = {
      flow: flow.id,
      title: flow.title,
      status: reason === undefined ? "pass" : "fail",
      ...(reason === undefined ? {} : { reason }),
      checks: run.checks,
      screenshots: run.screenshots,
      pageErrors: run.pageErrors,
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
    id: "flow-step3-create-attach",
    title:
      "Step 3 opens the dialog for the repository; a new provider is attached, listed and not the default; the stepper reaches Ready",
    run: async (flow) => {
      const repositoryKey: VisualRepositoryKey = "mainNeedsSecret";
      const workspace = VISUAL_WORKSPACES.main;
      const repository = VISUAL_REPOSITORIES[repositoryKey];
      const fullName = visualRepositoryFullName(repository);
      const defaultBefore = await defaultProfileId(flow.prisma, workspace.id);
      const page = await flow.open("owner", repositoryRoute(repositoryKey));

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
      await flow.shot(page, "step3-dialog");

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
      await flow.shot(page, "secret-confirmed");
      await page.getByRole("button", { name: "Close provider setup" }).click();
      await flow.check(
        "the stepper reaches Ready without reloading the page",
        async () =>
          expectEventually(async () =>
            expectMatch(
              await stepTitle(page, repositoryKey),
              /^4 of 4/,
              "step pill title",
            ),
          ),
      );
      await flow.check("the provider line names the new provider", async () => {
        await visible(
          repositorySetupPanel(page, repositoryKey).getByText(
            `Provider: ${created!.label}`,
            { exact: true },
          ),
        );
      });
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
      await flow.shot(page, "providers-list");
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
              .getByText(/^Claude Code subscription/)
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
            .getByText(/^Claude Code subscription/)
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
        workspaceRoute("empty", "repositories"),
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
      await flow.shot(owner, "no-default");
      const dialog = await openDialog(
        owner,
        owner.getByRole("button", { name: "Choose default provider" }),
      );
      await chooseNewProvider(dialog);
      await chooseSource(owner, dialog, SOURCE.claudeSecret);
      await dialog.getByRole("button", { name: "Set as default" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30_000 });
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
      await flow.shot(owner, "default-chosen");
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
