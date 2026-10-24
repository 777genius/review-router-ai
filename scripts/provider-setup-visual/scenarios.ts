/**
 * Screens of the provider setup visual qualification. A scenario names the
 * route, the signed-in users and, when the state needs interaction, a
 * `prepare` step that runs after the dashboard section rendered. Scenarios
 * whose screens S5/S6 still build stay `pendingUntil` that stage: once the UI
 * lands, write their `prepare` step and drop the marker.
 */
import type { Page } from "playwright-core";
import { dashboardPath } from "../../apps/web/app/dashboard/dashboard-section.js";
import {
  VISUAL_REPOSITORIES,
  VISUAL_WORKSPACES,
  visualRepositoryEnabled,
  visualRepositoryFullName,
  type VisualRepositoryKey,
  type VisualRunFlags,
  type VisualUserKey,
  type VisualWorkspaceKey,
} from "./fixture-contract.js";

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
  /** Listed but not captured until that stage's UI exists. */
  pendingUntil?: "S5" | "S6";
  /** Deployment flags the screen needs; other runs skip it. */
  requires?: Partial<VisualRunFlags>;
  /** Brings the screen into the state to capture. */
  prepare?: (context: ScenarioContext) => Promise<void>;
  /** Facts recorded in the manifest beside the screenshot. */
  probe?: (context: ScenarioContext) => Promise<unknown>;
}>;

function workspaceRoute(
  workspace: VisualWorkspaceKey,
  section: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  return dashboardPath({
    section,
    workspace: VISUAL_WORKSPACES[workspace].slug,
    ...extra,
  });
}

/** The repositories section with one repository's stepper opened. */
function repositoryRoute(key: VisualRepositoryKey): string {
  const repository = VISUAL_REPOSITORIES[key];
  return workspaceRoute(repository.workspace, "repositories", {
    repository: visualRepositoryFullName(repository),
  });
}

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

export const VISUAL_SCENARIOS: readonly VisualScenario[] = [
  // Existing screens: captured now to prove seed, sign-in and capture.
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
  {
    id: "locked-repositories",
    title: "Access rights on: no default, one attached repository",
    users: ["admin", "member"],
    route: workspaceRoute("locked", "repositories"),
    probe: repositoryRows("locked"),
  },
  {
    id: "empty-repositories",
    title: "No providers and no default: provider selection required",
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
    id: "workspace-other",
    title: "Dashboard -> Other (draft reviews; Access rights joins in S6)",
    users: ["owner", "member"],
    route: workspaceRoute("main", "other"),
  },

  // S5: unified provider dialog and the provider line.
  {
    id: "dialog-from-stepper-line",
    title: "Provider line 'Change' opens the dialog for one repository",
    users: ["owner"],
    route: repositoryRoute("mainNeedsSecret"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-row-indicator",
    title: "Row indicator 'Use a different provider' and back to default",
    users: ["owner"],
    route: repositoryRoute("mainSetupPr"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-bulk-assign",
    title: "Table header bulk assign with one conflict",
    users: ["owner"],
    route: workspaceRoute("main", "repositories"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-first-provider-gateway",
    title: "First provider of an empty workspace via the Account Gateway",
    users: ["owner"],
    route: workspaceRoute("empty", "repositories"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-first-provider-secret",
    title: "First provider via a GitHub secret (CLI, not found, confirm)",
    users: ["owner"],
    route: workspaceRoute("empty", "repositories"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-member-reasons",
    title: "Member: personal binding and unapplied managed key disabled",
    users: ["member"],
    route: repositoryRoute("mainNeedsSecret"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-locked-member",
    title: "Member under Access rights: attach refused with the reason",
    users: ["member"],
    route: workspaceRoute("locked", "repositories"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-gitlab",
    title: "GitLab repository: not available yet",
    users: ["owner"],
    route: repositoryRoute("mainGitLab"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    pendingUntil: "S5",
  },
  {
    id: "dialog-rotating-hidden",
    title: "Rotating Codex hidden while the flag is off",
    users: ["owner"],
    route: repositoryRoute("mainNeedsSecret"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    requires: { rotating: false },
    pendingUntil: "S5",
  },
  {
    id: "dialog-rotating-visible",
    title: "Rotating Codex offered while the flag is on",
    users: ["owner"],
    route: repositoryRoute("mainNeedsSecret"),
    widths: DIALOG_WIDTHS,
    fullPage: false,
    requires: { rotating: true },
    pendingUntil: "S5",
  },

  // S6: Providers list and Access rights. Routes follow S6's section names.
  {
    id: "providers-list",
    title: "Providers list: default badge, usage, creator row actions",
    users: ["owner", "admin", "member"],
    route: workspaceRoute("main", "providers"),
    pendingUntil: "S6",
  },
  {
    id: "providers-archive-refused",
    title: "Archive of a used provider refused",
    users: ["owner"],
    route: workspaceRoute("main", "providers"),
    pendingUntil: "S6",
  },
  {
    id: "providers-model-edit-refused",
    title: "Model edit refused with the repository list",
    users: ["owner"],
    route: workspaceRoute("main", "providers"),
    pendingUntil: "S6",
  },
  {
    id: "access-rights-off",
    title: "Other -> Access rights off (admin edits, member disabled)",
    users: ["admin", "member"],
    route: workspaceRoute("main", "other"),
    pendingUntil: "S6",
  },
  {
    id: "access-rights-on",
    title: "Other -> Access rights on (admin edits, member disabled)",
    users: ["admin", "member"],
    route: workspaceRoute("locked", "other"),
    pendingUntil: "S6",
  },
];
