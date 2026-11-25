import type { getDashboardWorkspaceScope } from "./dashboard-mutations";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma";
import type { DashboardRepositoryAccessScope } from "./dashboard-repository-access";
import {
  filterVisibleDashboardWorkspaces,
  type DashboardWorkspaceSummary,
} from "./dashboard-workspace-model";

/**
 * Owner-scoped read projection; never fetches an unselected repository through
 * a direct URL. This is the only dashboard summary query composition.
 *
 * The repository permission scope is already authorized by its own adapter;
 * this projection keeps workspace-wide and repository-only visibility distinct.
 */
export function createDashboardWorkspaceSummaryLoader(dependencies: {
  readonly getPrisma: typeof getPrisma;
}) {
  return async function loadDashboardWorkspaceSummaries(
    scope: Awaited<ReturnType<typeof getDashboardWorkspaceScope>>,
    repositoryAccess: DashboardRepositoryAccessScope,
    selection?: {
      readonly workspaceKey?: string;
      readonly installationId?: string;
    },
  ) {
    if (scope.kind === "none" && repositoryAccess.workspaceIds.length === 0) {
      return [];
    }
    if (
      scope.kind === "workspace_ids" &&
      scope.workspaceIds.length === 0 &&
      repositoryAccess.workspaceIds.length === 0
    ) {
      return [];
    }

    const prisma = dependencies.getPrisma();
    const workspaceIds = mergeWorkspaceIds(
      scope.kind === "workspace_ids" ? scope.workspaceIds : [],
      repositoryAccess.workspaceIds,
    );
    const workspaceWhere =
      scope.kind === "all" ? undefined : { id: { in: workspaceIds } };
    const repositoryVisibility =
      scope.kind === "all"
        ? {}
        : {
            OR: [
              {
                workspaceId: {
                  in:
                    scope.kind === "workspace_ids"
                      ? [...scope.workspaceIds]
                      : [],
                },
              },
              { id: { in: [...repositoryAccess.repositoryIds] } },
            ],
          };
    const installationSelect = {
      accountLogin: true,
      accountType: true,
      accountAvatarUrl: true,
      githubInstallationId: true,
      status: true,
      repositorySelection: true,
    } as const;
    const select = {
      id: true,
      name: true,
      slug: true,
      installations: {
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: installationSelect,
      },
      gitLabInstallations: {
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          sourceBaseUrl: true,
          namespacePath: true,
          sourceKind: true,
          status: true,
          selectedProjects: true,
          lastInstalledAt: true,
        },
      },
      _count: { select: { repositories: { where: repositoryVisibility } } },
      repositories: {
        where: repositoryVisibility,
        distinct: ["owner"],
        select: { owner: true },
      },
    } satisfies Prisma.WorkspaceSelect;
    const filters = requestedWorkspaceFilters(selection);
    let workspaces: Awaited<ReturnType<typeof read>> = [];
    function read(filter?: Prisma.WorkspaceWhereInput) {
      return prisma.workspace.findMany({
        ...(filter
          ? { where: { AND: [workspaceWhere ?? {}, filter] } }
          : workspaceWhere
            ? { where: workspaceWhere }
            : {}),
        orderBy: { createdAt: "desc" },
        take: filter ? 2 : 10,
        select,
      });
    }
    let resolvedFilter = -1;
    if (filters) {
      for (const [index, filter] of filters.entries()) {
        workspaces = await read(filter);
        if (workspaces.length > 0) {
          resolvedFilter = index;
          break;
        }
      }
    } else {
      workspaces = await read();
    }

    // Keep a legacy installation/account link resolvable even when that
    // installation is older than the three entries in the compact switcher.
    const installationWhere = selection?.workspaceKey?.trim()
      ? resolvedFilter === 2
        ? {
            accountLogin: {
              equals: selection.workspaceKey.trim(),
              mode: "insensitive" as const,
            },
          }
        : null
      : selection?.installationId && /^[0-9]+$/u.test(selection.installationId)
        ? { githubInstallationId: BigInt(selection.installationId) }
        : null;
    if (installationWhere && workspaces.length) {
      const requested = await prisma.workspace.findMany({
        where: { id: { in: workspaces.map((workspace) => workspace.id) } },
        take: 2,
        select: {
          id: true,
          installations: {
            where: installationWhere,
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: installationSelect,
          },
        },
      });
      workspaces = workspaces.map((workspace) => ({
        ...workspace,
        installations: [
          ...new Map(
            [
              ...workspace.installations,
              ...(requested.find((item) => item.id === workspace.id)
                ?.installations ?? []),
            ].map((installation) => [
              installation.githubInstallationId,
              installation,
            ]),
          ).values(),
        ],
      }));
    }

    const summaries = workspaces
      .map((workspace): DashboardWorkspaceSummary => {
        const hasWorkspaceWideAccess =
          scope.kind === "all" ||
          (scope.kind === "workspace_ids" &&
            scope.workspaceIds.includes(workspace.id));
        const visibleOwners = new Set(
          workspace.repositories.map((repository) =>
            repository.owner.toLowerCase(),
          ),
        );
        return {
          hasWorkspaceWideAccess,
          repositoryCount: workspace._count.repositories,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            installations: workspace.installations
              .filter(
                (installation) =>
                  hasWorkspaceWideAccess ||
                  visibleOwners.has(installation.accountLogin.toLowerCase()),
              )
              .map((installation) => ({
                ...installation,
                githubInstallationId:
                  installation.githubInstallationId.toString(),
                organizationSecretPolicy: null,
              })),
            gitLabInstallations: hasWorkspaceWideAccess
              ? workspace.gitLabInstallations
              : [],
            auditEvents: [],
          },
        };
      })
      .sort(compareDashboardWorkspaces);
    return filters ? summaries : filterVisibleDashboardWorkspaces(summaries);
  };
}

function requestedWorkspaceFilters(selection?: {
  readonly workspaceKey?: string;
  readonly installationId?: string;
}): readonly Prisma.WorkspaceWhereInput[] | null {
  const key = selection?.workspaceKey?.trim();
  if (key) {
    const equals = { equals: key, mode: "insensitive" as const };
    return [
      { id: equals },
      { slug: equals },
      {
        OR: [
          { name: equals },
          { installations: { some: { accountLogin: equals } } },
        ],
      },
    ];
  }
  if (selection?.installationId) {
    return /^[0-9]+$/u.test(selection.installationId)
      ? [
          {
            installations: {
              some: { githubInstallationId: BigInt(selection.installationId) },
            },
          },
        ]
      : [];
  }
  return null;
}

export const loadDashboardWorkspaceSummaries =
  createDashboardWorkspaceSummaryLoader({
    getPrisma,
  });

type SortableDashboardWorkspace = {
  readonly repositoryCount: number;
  readonly workspace: {
    readonly name: string;
    readonly installations: readonly { readonly status: string }[];
    readonly gitLabInstallations: readonly { readonly status: string }[];
  };
};

function compareDashboardWorkspaces(
  left: SortableDashboardWorkspace,
  right: SortableDashboardWorkspace,
): number {
  const leftScore = workspaceSortScore(left);
  const rightScore = workspaceSortScore(right);
  if (leftScore !== rightScore) return rightScore - leftScore;
  return left.workspace.name.localeCompare(right.workspace.name);
}

function workspaceSortScore(data: SortableDashboardWorkspace): number {
  const activeInstallations = data.workspace.installations.filter(
    (installation) => installation.status === "active",
  ).length;
  const activeGitLabInstallations = data.workspace.gitLabInstallations.filter(
    (installation) => installation.status === "active",
  ).length;
  return (
    data.repositoryCount * 100 +
    activeInstallations * 10 +
    activeGitLabInstallations * 10
  );
}

function mergeWorkspaceIds(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return [...new Set([...left, ...right])];
}
