/**
 * Screens of the provider setup visual qualification. A scenario names the
 * route, the signed-in users and, when the state needs interaction, a
 * `prepare` step that runs after the dashboard section rendered: it opens
 * the dialog or list action a user would and leaves the screen to capture.
 */
import type { Page } from "playwright-core";
import {
  VISUAL_REPOSITORIES,
  visualRepositoryEnabled,
  visualRepositoryFullName,
  type VisualRepositoryKey,
  type VisualRunFlags,
  type VisualUserKey,
  type VisualWorkspaceKey,
} from "./fixture-contract.js";
import {
  chooseCard,
  chooseModel,
  chooseNewProvider,
  chooseSource,
  openDialog,
  openSourceList,
  providerListRow,
  repositoryRoute,
  repositoryRowHeader,
  repositorySetupPanel,
  reveal,
  SOURCE,
  workspaceRoute,
} from "./ui.js";

export type VisualTheme = "light" | "dark";

export const VISUAL_THEMES: readonly VisualTheme[] = ["light", "dark"];
export const PAGE_WIDTHS: readonly number[] = [390, 1440];
/** The main dialog is also reviewed at the tablet width. */
export const DIALOG_WIDTHS: readonly number[] = [390, 900, 1440];

export type ScenarioContext = Readonly<{
  page: Page;
  flags: VisualRunFlags;
  user: VisualUserKey;
  width: number;
  theme: VisualTheme;
}>;

export type VisualScenario = Readonly<{
  /** Stable kebab-case ID; screenshot names start with it. */
  id: string;
  title: string;
  users: readonly VisualUserKey[];
  route: string;
  widths?: readonly number[];
  /** Whole page by default; dialogs capture the viewport. */
  fullPage?: boolean;
  /** Deployment flags the screen needs; other runs skip it. */
  requires?: Partial<VisualRunFlags>;
  /** Brings the screen into the state to capture. */
  prepare?: (context: ScenarioContext) => Promise<void>;
  /** Facts recorded in the manifest beside the screenshot. */
  probe?: (context: ScenarioContext) => Promise<unknown>;
}>;

/**
 * Step pill of every rendered repository row beside the contract's expected
 * step, and the workspace's repositories the page does not show; recorded
 * for the reviewer, not asserted, as S5 reshapes the stepper.
 */
function repositoryRows(workspace: VisualWorkspaceKey) {
  return async ({ page, flags }: ScenarioContext): Promise<unknown> => {
    const rows = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>("[data-repository-row-id]"),
      ].map((row) => {
        const disclosure = row.dataset.disclosureId ?? "";
        const pill = row.querySelector<HTMLElement>(
          `label[for="${CSS.escape(disclosure)}"]`,
        );
        return {
          repositoryId: row.dataset.repositoryRowId ?? "",
          step: pill?.title ?? null,
          pill: pill?.innerText.trim().replace(/\s+/g, " ") ?? null,
        };
      }),
    );
    const expected = Object.values(VISUAL_REPOSITORIES).filter(
      (repository) =>
        repository.workspace === workspace &&
        visualRepositoryEnabled(repository, flags),
    );
    const rendered = new Set(rows.map((row) => row.repositoryId));
    return {
      rows: rows.map((row) => ({
        ...row,
        expectedStep:
          expected.find((repository) => repository.id === row.repositoryId)
            ?.expected.step ?? null,
      })),
      missing: expected
        .filter((repository) => !rendered.has(repository.id))
        .map((repository) => visualRepositoryFullName(repository)),
    };
  };
}

/**
 * An opened stepper with an open setup PR asks the server 1 s later whether
 * it merged; capture after that check, as a user would see it.
 */
async function waitForSetupPullRequestCheck({
  page,
}: ScenarioContext): Promise<void> {
  await page.waitForTimeout(2_500);
}

function stepperScenario(
  id: string,
  title: string,
  repository: VisualRepositoryKey,
  users: readonly VisualUserKey[] = ["owner"],
): VisualScenario {
  return {
    id,
    title,
    users,
    route: repositoryRoute(repository),
    probe: repositoryRows(VISUAL_REPOSITORIES[repository].workspace),
    ...(VISUAL_REPOSITORIES[repository].setup === "setup_pr_open"
      ? { prepare: waitForSetupPullRequestCheck }
      : {}),
    ...(VISUAL_REPOSITORIES[repository].requiresRotating
      ? { requires: { rotating: true } }
      : {}),
  };
}

/** A dialog screen: viewport only, at the dialog widths. */
function dialogScenario(
  scenario: Omit<VisualScenario, "widths" | "fullPage">,
): VisualScenario {
  return { ...scenario, widths: DIALOG_WIDTHS, fullPage: false };
}

/** The provider line above the steps of an opened repository. */
function openFromStepperLine(
  repository: VisualRepositoryKey,
  action = "Use a different provider",
) {
  return ({ page }: ScenarioContext) =>
    openDialog(
      page,
      repositorySetupPanel(page, repository).getByRole("button", {
        name: action,
      }),
    );
}

/** The compact provider line in a repository row. */
function openFromRow(
  page: Page,
  repository: VisualRepositoryKey,
  action: string,
) {
  return openDialog(
    page,
    repositoryRowHeader(page, repository).getByRole("button", { name: action }),
  );
}

/** Waits until the credential step read the repository secrets. */
async function credentialStepSettled(page: Page): Promise<void> {
  await page
    .getByRole("dialog")
    .getByText("Checking the repository secrets on GitHub...")
    .waitFor({ state: "hidden", timeout: 30_000 });
}

/** Selects repositories in the table for "Configure providers". */
async function selectRepositories(
  page: Page,
  repositories: readonly VisualRepositoryKey[],
): Promise<void> {
  for (const key of repositories)
    await page
      .getByRole("checkbox", {
        name: `Select ${visualRepositoryFullName(VISUAL_REPOSITORIES[key])}`,
      })
      .check();
}

/** The member's bulk selection: one repository has the MiMo key, one not. */
const memberBulkRepositories: readonly VisualRepositoryKey[] = [
  "mainNeedsSecret",
  "mainWorkflowUpdate",
];
const ownerBulkRepositories: readonly VisualRepositoryKey[] = [
  "mainSetupPr",
  "mainMergeSetupPr",
  "mainNeedsSecret",
];

async function openBulkDialog({ page, user }: ScenarioContext) {
  await selectRepositories(
    page,
    user === "member" ? memberBulkRepositories : ownerBulkRepositories,
  );
  const dialog = await openDialog(
    page,
    page.getByRole("button", { name: "Configure providers" }),
  );
  if (user === "member") await chooseCard(dialog, "MiMo (server key)");
  return dialog;
}

export const VISUAL_SCENARIOS: readonly VisualScenario[] = [
  // Repository table and the setup steps of every state.
  {
    id: "workspace-repositories",
    title: "Repository table with every stepper state",
    users: ["owner", "admin", "member"],
    route: workspaceRoute("main", "repositories"),
    probe: repositoryRows("main"),
  },
  stepperScenario(
    "stepper-setup-pr",
    "Stepper: create the setup PR (inherits the default)",
    "mainSetupPr",
  ),
  stepperScenario(
    "stepper-merge-setup-pr",
    "Stepper: merge the open setup PR",
    "mainMergeSetupPr",
  ),
  stepperScenario(
    "stepper-provider-credential",
    "Stepper: the inherited CI-secret provider needs its secret",
    "mainNeedsSecret",
    ["owner", "member"],
  ),
  stepperScenario(
    "stepper-ready",
    "Stepper: ready with the inherited default",
    "mainReady",
  ),
  stepperScenario(
    "stepper-own-gateway",
    "Repository with its own Gateway provider (created by the admin)",
    "mainOwnGateway",
  ),
  stepperScenario(
    "stepper-member-profile",
    "Repository using the provider its member maintainer created",
    "mainMemberProfile",
    ["owner", "member"],
  ),
  stepperScenario(
    "stepper-workflow-update",
    "Own managed-key provider over a workflow rendered for the default",
    "mainWorkflowUpdate",
  ),
  stepperScenario(
    "stepper-rotating",
    "Repository with rotating Codex (flag on)",
    "mainRotating",
  ),
  stepperScenario(
    "stepper-gitlab",
    "GitLab project: no provider line, setup not available yet",
    "mainGitLab",
  ),
  {
    id: "locked-repositories",
    title: "Access rights on: no default, one attached repository",
    users: ["admin", "member"],
    route: workspaceRoute("locked", "repositories"),
    probe: repositoryRows("locked"),
  },
  {
    id: "empty-repositories",
    title: "No providers and no default: table, banner and the one action",
    users: ["owner", "member"],
    route: workspaceRoute("empty", "repositories"),
    probe: repositoryRows("empty"),
  },
  {
    id: "workspace-model",
    title: "Model section of a workspace with a default",
    users: ["owner", "member"],
    route: workspaceRoute("main", "policy"),
  },
  {
    id: "workspace-model-no-default",
    title: "Model section of a workspace without a default",
    users: ["owner"],
    route: workspaceRoute("empty", "policy"),
  },

  // The provider dialog, opened from every entry point.
  dialogScenario({
    id: "dialog-step3-credential",
    title:
      "Original bug: step 3 'Add secret' opens the one dialog for this repository",
    users: ["owner", "member"],
    route: repositoryRoute("mainNeedsSecret"),
    prepare: async ({ page }) => {
      await openDialog(
        page,
        repositorySetupPanel(page, "mainNeedsSecret").getByRole("button", {
          name: "Add secret",
        }),
      );
      await credentialStepSettled(page);
    },
  }),
  dialogScenario({
    id: "dialog-from-stepper-line",
    title: "Provider line above the steps opens the dialog for one repository",
    users: ["owner"],
    route: repositoryRoute("mainNeedsSecret"),
    prepare: async (context) => {
      await openFromStepperLine("mainNeedsSecret")(context);
    },
  }),
  dialogScenario({
    id: "dialog-row-indicator",
    title: "Row line 'Use a different provider' of an inheriting repository",
    users: ["owner"],
    route: workspaceRoute("main", "repositories"),
    prepare: async ({ page }) => {
      await openFromRow(page, "mainSetupPr", "Use a different provider");
    },
  }),
  dialogScenario({
    id: "dialog-back-to-default",
    title: "Repository with its own provider goes back to the default",
    users: ["owner"],
    route: workspaceRoute("main", "repositories"),
    prepare: async ({ page }) => {
      const dialog = await openFromRow(page, "mainOwnGateway", "Change");
      await chooseCard(dialog, /^Workspace default:/);
      await reveal(
        dialog.getByRole("button", { name: "Use the workspace default" }),
      );
    },
  }),
  dialogScenario({
    id: "dialog-new-provider-key",
    title: "New API-key provider for one repository: explicit storage choice",
    users: ["owner"],
    route: workspaceRoute("main", "repositories"),
    prepare: async ({ page }) => {
      const dialog = await openFromRow(
        page,
        "mainSetupPr",
        "Use a different provider",
      );
      await chooseNewProvider(dialog);
      await chooseSource(page, dialog, SOURCE.openRouterKey);
      await reveal(dialog.getByRole("radiogroup", { name: "Key storage" }));
    },
  }),
  dialogScenario({
    id: "dialog-member-reasons",
    title: "Member: providers they cannot use stay visible with the reason",
    users: ["member"],
    route: repositoryRoute("mainNeedsSecret"),
    prepare: async (context) => {
      await openFromStepperLine("mainNeedsSecret")(context);
    },
  }),
  dialogScenario({
    id: "dialog-member-sources",
    title: "Member: credential sources, disabled ones say why",
    users: ["member"],
    route: repositoryRoute("mainNeedsSecret"),
    prepare: async (context) => {
      const dialog = await openFromStepperLine("mainNeedsSecret")(context);
      await chooseNewProvider(dialog);
      await openSourceList(context.page, dialog);
    },
  }),
  dialogScenario({
    id: "dialog-bulk-assign",
    title:
      "Table header 'Configure providers' (member: refused in one repository)",
    users: ["owner", "member"],
    route: workspaceRoute("main", "repositories"),
    prepare: async (context) => {
      await openBulkDialog(context);
    },
  }),
  dialogScenario({
    id: "dialog-bulk-results",
    title: "Bulk result: set in one repository, refused in the other",
    users: ["member"],
    route: workspaceRoute("main", "repositories"),
    prepare: async (context) => {
      const dialog = await openBulkDialog(context);
      await dialog
        .getByRole("button", {
          name: `Use for ${memberBulkRepositories.length} repositories`,
        })
        .click();
      await dialog.getByRole("button", { name: "Done" }).waitFor();
    },
  }),
  dialogScenario({
    id: "dialog-locked-member",
    title: "Member under Access rights: choices disabled with the reason",
    users: ["member"],
    route: workspaceRoute("locked", "repositories"),
    prepare: async ({ page }) => {
      await openFromRow(page, "lockedUnselected", "Choose provider");
    },
  }),
  dialogScenario({
    id: "dialog-rotating-hidden",
    title: "Credential sources without rotating Codex (flag off)",
    users: ["owner"],
    route: repositoryRoute("mainNeedsSecret"),
    requires: { rotating: false },
    prepare: async (context) => {
      const dialog = await openFromStepperLine("mainNeedsSecret")(context);
      await chooseNewProvider(dialog);
      await openSourceList(context.page, dialog);
    },
  }),
  dialogScenario({
    id: "dialog-rotating-visible",
    title: "Credential sources with rotating Codex (flag on)",
    users: ["owner"],
    route: repositoryRoute("mainNeedsSecret"),
    requires: { rotating: true },
    prepare: async (context) => {
      const dialog = await openFromStepperLine("mainNeedsSecret")(context);
      await chooseNewProvider(dialog);
      await openSourceList(context.page, dialog);
    },
  }),
  dialogScenario({
    id: "dialog-first-provider-gateway",
    title:
      "First default of an empty workspace: connected account, none active",
    users: ["owner"],
    route: workspaceRoute("empty", "repositories"),
    prepare: async ({ page }) => {
      const dialog = await openDialog(
        page,
        page.getByRole("button", { name: "Choose default provider" }),
      );
      await chooseNewProvider(dialog);
    },
  }),
  dialogScenario({
    id: "dialog-first-provider-secret",
    title: "First default of an empty workspace: a GitHub secret",
    users: ["owner"],
    route: workspaceRoute("empty", "repositories"),
    prepare: async ({ page }) => {
      const dialog = await openDialog(
        page,
        page.getByRole("button", { name: "Choose default provider" }),
      );
      await chooseNewProvider(dialog);
      await chooseSource(page, dialog, SOURCE.claudeSecret);
    },
  }),
  dialogScenario({
    id: "dialog-workspace-default",
    title: "Model section: change the workspace default",
    users: ["owner"],
    route: workspaceRoute("main", "policy"),
    prepare: async ({ page }) => {
      await openDialog(page, page.getByRole("button", { name: "Change" }));
    },
  }),
  dialogScenario({
    id: "dialog-add-provider",
    title: "Providers: add a provider to the list",
    users: ["owner"],
    route: workspaceRoute("main", "providers"),
    prepare: async ({ page }) => {
      const dialog = await openDialog(
        page,
        page.getByRole("button", { name: "Add provider" }),
      );
      await chooseSource(page, dialog, SOURCE.claudeSecret);
    },
  }),
  dialogScenario({
    id: "dialog-make-default",
    title: "Providers: make a member's provider the default (admin)",
    users: ["admin"],
    route: workspaceRoute("main", "providers"),
    prepare: async ({ page }) => {
      await openDialog(
        page,
        providerListRow(page, "Member MiMo secret").getByRole("button", {
          name: "Make default",
        }),
      );
    },
  }),
  dialogScenario({
    id: "dialog-edit-provider",
    title: "Providers: edit the name and model of the default",
    users: ["owner"],
    route: workspaceRoute("main", "providers"),
    prepare: async ({ page }) => {
      await openDialog(
        page,
        providerListRow(page, "Claude Code (team default)").getByRole(
          "button",
          { name: "Edit" },
        ),
      );
    },
  }),
  dialogScenario({
    id: "providers-model-edit-refused",
    title: "Model edit refused, naming the repository it would break",
    users: ["owner"],
    route: workspaceRoute("main", "providers"),
    requires: { rotating: true },
    prepare: async ({ page }) => {
      const dialog = await openDialog(
        page,
        providerListRow(page, "Rotating Codex").getByRole("button", {
          name: "Edit",
        }),
      );
      await chooseModel(dialog, "gpt-5.5");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await dialog.getByRole("alert").waitFor({ timeout: 30_000 });
    },
  }),
  dialogScenario({
    id: "providers-remove-confirm",
    title: "Remove an unused provider: the confirmation",
    users: ["owner"],
    route: workspaceRoute("main", "providers"),
    prepare: async ({ page }) => {
      await openDialog(
        page,
        providerListRow(page, "Hosted ChatGPT pool").getByRole("button", {
          name: "Remove",
          exact: true,
        }),
      );
    },
  }),

  // Providers list and Access rights.
  {
    id: "providers-list",
    title: "Providers list: default badge, usage, creator, allowed actions",
    users: ["owner", "admin", "member"],
    route: workspaceRoute("main", "providers"),
  },
  {
    id: "providers-empty",
    title: "Providers list of a workspace without providers",
    users: ["owner", "member"],
    route: workspaceRoute("empty", "providers"),
  },
  {
    id: "providers-locked",
    title: "Providers list under Access rights",
    users: ["admin", "member"],
    route: workspaceRoute("locked", "providers"),
  },
  {
    id: "access-rights-off",
    title: "Other: Access rights off (owner and admin edit, member disabled)",
    users: ["owner", "admin", "member"],
    route: workspaceRoute("main", "other"),
  },
  {
    id: "access-rights-on",
    title: "Other: Access rights on (admin edits, member disabled)",
    users: ["admin", "member"],
    route: workspaceRoute("locked", "other"),
  },
];
