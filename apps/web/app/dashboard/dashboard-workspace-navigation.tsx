import { Badge } from "@reviewrouter/ui";
import type { PendingOrganizationInstallRequest } from "../../src/server/dashboard-app-install-request";
import { ConnectSourceDialog } from "../connect-source-dialog";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { DashboardWorkspaceTabs } from "./dashboard-workspace-tabs";
import {
  DashboardSectionCompactNav,
  DashboardSectionTabs,
} from "./dashboard-section-tabs";
import {
  DASHBOARD_SECTIONS,
  dashboardSectionHref,
  dashboardSectionMeta,
  type DashboardSection,
} from "./dashboard-section";
import { workspaceInstallSummary } from "./dashboard-copy";

export type DashboardWorkspace = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly installations: readonly {
    readonly accountLogin: string;
    readonly accountType: string;
    readonly accountAvatarUrl: string | null;
    readonly githubInstallationId: string;
    readonly status: string;
    readonly repositorySelection: string;
    readonly organizationSecretPolicy: DashboardOrganizationSecretPolicy | null;
  }[];
  readonly gitLabInstallations: readonly {
    readonly id: string;
    readonly sourceBaseUrl: string;
    readonly namespacePath: string;
    readonly sourceKind: string;
    readonly status: string;
    readonly selectedProjects: number;
    readonly lastInstalledAt: Date | null;
  }[];
  readonly auditEvents: readonly {
    readonly action: string;
    readonly actor: string;
    readonly targetType: string;
    readonly createdAt: Date;
  }[];
};

export type DashboardOrganizationSecretPolicy = {
  readonly planName: string | null;
  readonly privateRepositoriesAvailable: boolean | null;
  readonly status: "available" | "permission_required" | "unknown";
};

export type DashboardWorkspaceSummary = {
  readonly workspace: DashboardWorkspace;
  readonly repositoryCount: number;
  readonly hasWorkspaceWideAccess: boolean;
};

export function filterVisibleDashboardWorkspaces(
  workspaces: readonly DashboardWorkspaceSummary[],
): readonly DashboardWorkspaceSummary[] {
  const actionableWorkspaces = workspaces.filter(
    (workspace) =>
      workspace.repositoryCount > 0 ||
      workspace.workspace.installations.length > 0 ||
      workspace.workspace.gitLabInstallations.length > 0,
  );

  return actionableWorkspaces.length > 0 ? actionableWorkspaces : workspaces;
}

export function selectDashboardWorkspace(
  workspaces: readonly DashboardWorkspaceSummary[],
  workspaceParam: string,
  installationIdParam = "",
): DashboardWorkspaceSummary {
  if (!workspaceParam && installationIdParam) {
    const byInstallation = workspaces.find((workspace) =>
      workspace.workspace.installations.some(
        (installation) =>
          installation.githubInstallationId === installationIdParam,
      ),
    );
    if (byInstallation) return byInstallation;
  }

  if (!workspaceParam) return workspaces[0]!;

  const normalized = normalizeWorkspaceKey(workspaceParam);
  return (
    workspaces.find((workspace) =>
      dashboardWorkspaceKeys(workspace.workspace).includes(normalized),
    ) ?? workspaces[0]!
  );
}

function dashboardWorkspaceKeys(workspace: DashboardWorkspace): string[] {
  return [
    workspace.id,
    workspace.slug,
    workspace.name,
    ...workspace.installations.map((installation) => installation.accountLogin),
  ]
    .filter(Boolean)
    .map(normalizeWorkspaceKey);
}

export function dashboardWorkspaceUrlKey(
  workspace: DashboardWorkspace,
  allWorkspaces?: readonly DashboardWorkspaceSummary[],
): string {
  const preferredKey = dashboardWorkspacePreferredUrlKey(workspace);
  if (!allWorkspaces) return preferredKey;

  const preferredKeyCollision = allWorkspaces.some(
    (item) =>
      item.workspace.id !== workspace.id &&
      normalizeWorkspaceKey(
        dashboardWorkspacePreferredUrlKey(item.workspace),
      ) === normalizeWorkspaceKey(preferredKey),
  );
  const preferredKeyNamesWorkspace =
    normalizeWorkspaceKey(workspace.name) ===
    normalizeWorkspaceKey(preferredKey);

  if (!preferredKeyCollision || preferredKeyNamesWorkspace) {
    return preferredKey;
  }

  return workspace.slug || workspace.id;
}

function dashboardWorkspacePreferredUrlKey(
  workspace: DashboardWorkspace,
): string {
  return (
    workspace.installations[0]?.accountLogin || workspace.slug || workspace.id
  );
}

function workspaceAvatarUrl(
  workspace: DashboardWorkspace,
  fallbackUser?: {
    readonly githubLogin: string | null;
    readonly githubAvatarUrl: string | null;
  },
): string | null {
  const installationAvatar =
    workspace.installations.find(
      (installation) => installation.status === "active",
    )?.accountAvatarUrl ??
    workspace.installations[0]?.accountAvatarUrl ??
    null;
  if (installationAvatar) return installationAvatar;

  const personalInstallation = workspace.installations.find(
    (installation) =>
      installation.accountType === "User" &&
      installation.accountLogin === fallbackUser?.githubLogin,
  );
  if (personalInstallation && fallbackUser?.githubAvatarUrl) {
    return fallbackUser.githubAvatarUrl;
  }

  return githubAvatarUrlForLogin(workspace.installations[0]?.accountLogin);
}

function githubAvatarUrlForLogin(
  login: string | null | undefined,
): string | null {
  if (!login || !/^[A-Za-z0-9-]+$/.test(login)) {
    return null;
  }

  return `https://github.com/${login}.png?size=64`;
}

function normalizeWorkspaceKey(value: string): string {
  return value.trim().toLowerCase();
}

export function WorkspaceSwitcher({
  workspaces,
  selectedWorkspaceId,
  selectedSection,
  appInstallUrl,
  pendingOrganizationInstallRequest,
  fallbackUser,
}: {
  readonly workspaces: readonly DashboardWorkspaceSummary[];
  readonly selectedWorkspaceId: string;
  readonly selectedSection: DashboardSection;
  readonly appInstallUrl: string | null;
  readonly pendingOrganizationInstallRequest: PendingOrganizationInstallRequest | null;
  readonly fallbackUser: {
    readonly githubLogin: string | null;
    readonly githubAvatarUrl: string | null;
  };
}): React.ReactElement | null {
  if (workspaces.length < 2 && !pendingOrganizationInstallRequest) {
    return (
      <section className="py-3">
        <div className="flex justify-end px-1">
          <ConnectSourceDialog
            appInstallUrl={appInstallUrl}
            workspaceId={selectedWorkspaceId}
            triggerLabel="Add repos"
            triggerVariant="outline"
            triggerSize="sm"
            triggerClassName="inline-flex w-auto items-center gap-2 px-3"
          />
        </div>
      </section>
    );
  }

  const items = workspaces.map((workspace) => {
    const workspaceKey = dashboardWorkspaceUrlKey(
      workspace.workspace,
      workspaces,
    );
    return {
      id: workspace.workspace.id,
      label: workspace.workspace.name,
      avatarUrl: workspaceAvatarUrl(workspace.workspace, fallbackUser),
      repositoryCount: workspace.repositoryCount,
      ...(workspace.hasWorkspaceWideAccess
        ? {}
        : { statusLabel: "Repo access" }),
      href: dashboardSectionHref(selectedSection, workspaceKey),
    };
  });
  const pendingTab = pendingOrganizationInstallRequest
    ? {
        id: pendingOrganizationInstallRequest.id,
        label: pendingOrganizationInstallRequest.accountLogin,
        href: dashboardSectionHref(selectedSection),
        statusLabel: "Request pending",
      }
    : null;

  return (
    <section className="py-3">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              Workspace
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Personal accounts and organizations stay isolated.
            </p>
          </div>
          <ConnectSourceDialog
            appInstallUrl={appInstallUrl}
            workspaceId={selectedWorkspaceId}
            triggerLabel="Add repos"
            triggerVariant="outline"
            triggerSize="sm"
            triggerClassName="inline-flex w-auto items-center gap-2 px-3"
          />
        </div>
        {items.length > 1 || pendingTab ? (
          <DashboardWorkspaceTabs
            items={items}
            selectedWorkspaceId={selectedWorkspaceId}
            pendingInstallRequest={pendingTab}
          />
        ) : null}
      </div>
    </section>
  );
}

export function DashboardSectionNav({
  workspace,
  repositoryCount,
  selectedSection,
  workspaceKey,
  fallbackUser,
}: {
  readonly workspace: DashboardWorkspace;
  readonly repositoryCount: number;
  readonly selectedSection: DashboardSection;
  readonly workspaceKey: string;
  readonly fallbackUser: {
    readonly githubLogin: string | null;
    readonly githubAvatarUrl: string | null;
  };
}): React.ReactElement {
  const avatarUrl = workspaceAvatarUrl(workspace, fallbackUser);
  const items = DASHBOARD_SECTIONS.map((section) => ({
    section,
    label: dashboardSectionMeta[section].title,
    description: dashboardSectionMeta[section].navDescription,
    href: dashboardSectionHref(section, workspaceKey),
  }));

  return (
    <aside className="min-w-0 px-1 py-1 lg:p-5">
      <DashboardSectionCompactNav
        items={items}
        selectedSection={selectedSection}
      />
      <div className="hidden gap-4 lg:sticky lg:top-24 lg:grid">
        <div className="px-1 py-1">
          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Current workspace
          </p>
          <div className="mt-2 flex min-w-0 items-center gap-3">
            <GitHubAccountAvatar
              avatarUrl={avatarUrl}
              login={workspace.name}
              size="md"
            />
            <p className="truncate text-xl font-semibold text-cyan-50">
              {workspace.name}
            </p>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {workspaceInstallSummary(workspace)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="neutral">{repositoryCount} repos</Badge>
          </div>
        </div>
        <DashboardSectionTabs items={items} selectedSection={selectedSection} />
      </div>
    </aside>
  );
}
