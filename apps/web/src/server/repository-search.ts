import type { RepositoryHealthStatus } from "@reviewrouter/features-repo-health";
import { describeRepositoryHealth } from "./repository-health-view";

export type RepositorySetupStatus =
  | "not_configured"
  | "setup_pr_open"
  | "configured"
  | "needs_attention";

export function buildRepositorySearchText({
  fullName,
  owner,
  name,
  defaultBranch,
  visibility,
  stargazersCount,
  archived,
  selected,
  setupStatus,
  healthStatus,
  healthSummary,
}: {
  readonly fullName: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly visibility: string;
  readonly stargazersCount: number;
  readonly archived: boolean;
  readonly selected: boolean;
  readonly setupStatus: string;
  readonly healthStatus: RepositoryHealthStatus | undefined;
  readonly healthSummary?: string | null | undefined;
}): string {
  const setupView = describeRepositorySetup(setupStatus, healthStatus);
  const healthView = describeRepositoryHealth(healthStatus, healthSummary);

  return [
    fullName,
    owner,
    name,
    defaultBranch,
    visibility,
    `${stargazersCount} stars`,
    archived ? "archived" : "active",
    selected ? "selected" : "not selected unselected",
    setupStatus,
    setupView.label,
    setupView.hint ?? "",
    healthView.label,
    healthView.summary,
    healthView.nextAction,
  ]
    .join(" ")
    .toLowerCase();
}

export function tokenizeRepositorySearch(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function describeRepositorySetup(
  setupStatus: string,
  healthStatus: string | undefined,
): {
  readonly label: string;
  readonly tone: "success" | "warning" | "danger" | "neutral";
  readonly hint: string | null;
} {
  if (healthStatus === "missing_workflow") {
    return {
      label: "Setup PR needed",
      tone: "warning",
      hint: "Workflow is not on the setup PR target branch yet.",
    };
  }

  switch (setupStatus) {
    case "not_configured":
      return {
        label: "No setup PR",
        tone: "neutral",
        hint: "Create and merge the setup PR first.",
      };
    case "setup_pr_open":
      return {
        label: "Setup PR open",
        tone: "warning",
        hint: "Merge it to install the workflow.",
      };
    case "configured":
      return {
        label: "Setup recorded",
        tone: "success",
        hint: null,
      };
    case "needs_attention":
      return {
        label: "Needs attention",
        tone: "danger",
        hint: "Fix the setup error, then retry.",
      };
    default:
      return {
        label: setupStatus.replaceAll("_", " "),
        tone: "neutral",
        hint: null,
      };
  }
}
