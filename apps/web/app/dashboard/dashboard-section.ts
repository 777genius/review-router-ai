import { isMemoryError } from "./dashboard-copy";

export type DashboardSection =
  | "repositories"
  | "skills"
  | "memory"
  | "setup"
  | "providers"
  | "policy"
  | "diagnostics"
  | "usage"
  | "statistics"
  | "other";

export const DASHBOARD_SECTIONS = [
  "repositories",
  "statistics",
  "setup",
  "providers",
  "policy",
  "diagnostics",
  "usage",
  "other",
  "skills",
  "memory",
] as const satisfies readonly DashboardSection[];

// Connections retains its setup route as a view within the Providers area.
export const DASHBOARD_NAV_SECTIONS = DASHBOARD_SECTIONS.filter(
  (section) => section !== "setup",
);

export const dashboardSectionMeta: Record<
  DashboardSection,
  {
    readonly eyebrow: string;
    readonly title: string;
    readonly description: string;
    readonly navDescription: string;
  }
> = {
  repositories: {
    eyebrow: "Repository setup",
    title: "Repositories",
    description:
      "Choose a provider and follow each repository's setup steps. Finish its connection and workflow setup here.",
    navDescription: "Setup PRs and health",
  },
  skills: {
    eyebrow: "Review instructions",
    title: "Skills",
    description:
      "Create and share review instructions, then choose the repositories that use them.",
    navDescription: "Reusable review instructions",
  },
  memory: {
    eyebrow: "Shared review knowledge",
    title: "Memory",
    description:
      "Manage approved rules and historical knowledge for future reviews.",
    navDescription: "Approved review knowledge",
  },
  setup: {
    eyebrow: "Provider connections",
    title: "Providers",
    description:
      "Connect accounts to ReviewRouter and choose which workspaces can use them. Select them for reviews in Providers.",
    navDescription: "Workspace provider accounts",
  },
  providers: {
    eyebrow: "Workspace providers",
    title: "Providers",
    description:
      "Choose providers and models for reviews, and manage the connections they use.",
    navDescription: "Connections and models",
  },
  policy: {
    eyebrow: "Review behavior",
    title: "Review settings",
    description:
      "Set review behavior and quality gates for repositories in this workspace.",
    navDescription: "Review behavior and gates",
  },
  statistics: {
    eyebrow: "Review activity",
    title: "Statistics",
    description:
      "Published reviews, pull requests and issues caught in your workspace.",
    navDescription: "Reviews and issues caught",
  },
  usage: {
    eyebrow: "Measured consumption",
    title: "Usage",
    description:
      "Provider attempts, known tokens and cost, with source coverage.",
    navDescription: "Provider usage and coverage",
  },
  other: {
    eyebrow: "Workspace settings",
    title: "Other",
    description:
      "Additional review settings for every repository in this workspace.",
    navDescription: "Workspace review settings",
  },
  diagnostics: {
    eyebrow: "Operations",
    title: "Diagnostics",
    description:
      "Metadata-only health, queue failures, audit events, and support diagnostics.",
    navDescription: "Queue, audit, support",
  },
};

export function readDashboardSearchParam(
  value: string | string[] | undefined,
): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export function isDashboardSection(value: string): value is DashboardSection {
  return (DASHBOARD_SECTIONS as readonly string[]).includes(value);
}

export function dashboardPath(params: Record<string, string>): string {
  const section = params.section;
  const query = new URLSearchParams();
  if (section && section !== "setup") {
    query.set("section", section);
  }
  for (const [key, value] of Object.entries(params)) {
    if (!value || key === "section") continue;
    query.set(key, value);
  }
  const path = section === "setup" ? "/dashboard/setup" : "/dashboard";
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function dashboardPathFromSearchParams(
  params: Record<string, string | string[] | undefined>,
  section?: DashboardSection,
): string {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const text = readDashboardSearchParam(value).trim();
    if (text) flat[key] = text;
  }
  if (section) {
    flat.section = section;
  }
  return dashboardPath(flat);
}

export function dashboardSectionHref(
  section: DashboardSection,
  workspaceKey?: string,
): string {
  return `${dashboardPath({
    section,
    ...(workspaceKey ? { workspace: workspaceKey } : {}),
  })}#dashboard-section-content`;
}

/**
 * Persistent dashboard navigation keeps the shell mounted, so client-side
 * transitions do not need a fragment jump. Keeping the fragment out of the
 * Next Link also prevents revisiting a cached route from duplicating it.
 */
export function dashboardClientNavigationHref(href: string): string {
  const fragmentIndex = href.indexOf("#");
  return fragmentIndex === -1 ? href : href.slice(0, fragmentIndex);
}

export function resolveDashboardSection(
  params: Record<string, string | string[] | undefined>,
): DashboardSection {
  const explicit = readDashboardSearchParam(params.section);
  if (isDashboardSection(explicit)) return explicit;

  const notice = readDashboardSearchParam(params.notice);
  if (
    [
      "app_installed",
      "setup_pr_ready",
      "setup_pr_merged",
      "provider_setup_confirmed",
      "workflow_already_current",
      "sync_requested",
      "sync_already_requested",
      "repository_access_refreshed",
    ].includes(notice)
  ) {
    return "repositories";
  }
  if (notice === "org_ruleset_queued") {
    return "repositories";
  }
  if (
    [
      "memory_saved",
      "memory_suggestion_confirmed",
      "memory_suggestion_rejected",
      "memory_disabled",
      "memory_deleted",
      "memory_duplicate",
      "memory_already_confirmed",
      "memory_already_rejected",
      "memory_already_disabled",
      "memory_already_deleted",
      "memory_noop",
    ].includes(notice)
  ) {
    return "memory";
  }
  if (
    [
      "review_config_saved",
      "repository_review_config_saved",
      "repository_review_config_cleared",
    ].includes(notice)
  ) {
    return "policy";
  }
  if (notice.startsWith("outbox_retry_")) return "diagnostics";
  if (isMemoryError(readDashboardSearchParam(params.error))) return "memory";
  if (readDashboardSearchParam(params.error)) return "setup";
  return "repositories";
}
