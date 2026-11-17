import type { DashboardOrganizationSecretPolicy } from "./dashboard-organization-secret-policy";

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

function normalizeWorkspaceKey(value: string): string {
  return value.trim().toLowerCase();
}

type DashboardGitHubInstallationIdentity = {
  readonly accountLogin: string;
  readonly accountType: string;
  readonly githubInstallationId: string;
};

/**
 * One installation per GitHub account: a reinstall leaves the older row
 * behind, so the highest installation ID is the current one.
 */
export function latestInstallationPerAccount<
  T extends DashboardGitHubInstallationIdentity,
>(installations: readonly T[]): readonly T[] {
  const byAccount = new Map<string, T>();
  for (const installation of installations) {
    const key =
      `${installation.accountType}:${installation.accountLogin}`.toLowerCase();
    const current = byAccount.get(key);
    if (
      !current ||
      compareInstallationIds(
        installation.githubInstallationId,
        current.githubInstallationId,
      ) > 0
    ) {
      byAccount.set(key, installation);
    }
  }
  return [...byAccount.values()];
}

function compareInstallationIds(left: string, right: string): number {
  if (/^[0-9]+$/u.test(left) && /^[0-9]+$/u.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
  }
  return left.localeCompare(right);
}
