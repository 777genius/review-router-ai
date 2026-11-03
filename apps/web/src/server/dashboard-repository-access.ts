import {
  asDashboardGitHubActor,
  canDashboardActorConfigureRepository,
  canDashboardActorMutateRepository,
  type DashboardMutationActor,
} from "./dashboard-mutations";
import type { getDashboardWorkspaceScope } from "./dashboard-mutations";
import {
  listGitHubUserRepositoryAccess,
  type GitHubUserRepositoryAccessScope,
  type GitHubUserRepositoryAccessStatus,
} from "./github-user-repository-access";
import { getPrisma } from "./prisma";

/**
 * Read-only repository visibility is separate from dashboard rendering.
 *
 * The GitHub actor requirement and the explicit per-repository authority check
 * are intentionally preserved. Having a requested full name does not imply
 * repository access or workspace configuration permission.
 */
export type DashboardRepositoryAccessScope = GitHubUserRepositoryAccessScope;

export function createDashboardRepositoryAccessLoader(dependencies: {
  readonly getPrisma: typeof getPrisma;
  readonly listAccess: typeof listGitHubUserRepositoryAccess;
  readonly canMutate: typeof canDashboardActorMutateRepository;
  readonly canConfigure: typeof canDashboardActorConfigureRepository;
}) {
  return async function listDashboardRepositoryAccess(input: {
    readonly actor: DashboardMutationActor | null;
    readonly workspaceScope: Awaited<
      ReturnType<typeof getDashboardWorkspaceScope>
    >;
    readonly requestedRepositoryFullName: string;
    readonly baseAccess?: DashboardRepositoryAccessScope;
  }): Promise<DashboardRepositoryAccessScope> {
    const actor = input.actor;
    if (!actor || input.workspaceScope.kind === "all") {
      return emptyDashboardRepositoryAccess();
    }
    const githubActor = asDashboardGitHubActor(actor);
    if (!githubActor) {
      return emptyDashboardRepositoryAccess();
    }

    const fullAccessWorkspaceIds =
      input.workspaceScope.kind === "workspace_ids"
        ? input.workspaceScope.workspaceIds
        : [];
    const prisma = dependencies.getPrisma();
    const discovered =
      input.baseAccess ??
      (await dependencies.listAccess({
        prisma,
        actor: githubActor,
        excludedWorkspaceIds: fullAccessWorkspaceIds,
      }));
    const requestedRepositoryFullName = normalizeRequestedRepositoryFullName(
      input.requestedRepositoryFullName,
    );
    if (discovered.status !== "ready" || !requestedRepositoryFullName) {
      return discovered;
    }

    const candidateWhere = {
      provider: "github" as const,
      selected: true,
      archived: false,
      installation: { status: "active" },
      githubRepositoryId: { not: null },
      ...(fullAccessWorkspaceIds.length > 0
        ? { workspaceId: { notIn: [...fullAccessWorkspaceIds] } }
        : {}),
    } as const;
    const requestedCandidates = requestedRepositoryFullName
      ? await prisma.repositoryConnection.findMany({
          where: {
            ...candidateWhere,
            fullName: requestedRepositoryFullName,
          },
          select: {
            id: true,
            workspaceId: true,
            githubRepositoryId: true,
            owner: true,
            name: true,
            installation: { select: { githubInstallationId: true } },
          },
        })
      : [];
    const candidates = dedupeRepositoryAccessCandidates(
      requestedCandidates,
    ).flatMap((repository) =>
      repository.githubRepositoryId && repository.installation
        ? [
            {
              ...repository,
              githubRepositoryId: repository.githubRepositoryId,
              installation: repository.installation,
            },
          ]
        : [],
    );
    const allowed = await Promise.all(
      candidates.map(async (repository) => {
        const allowed = await dependencies.canMutate({
          actor,
          repository,
        });
        const canConfigure = allowed
          ? await dependencies.canConfigure({
              actor,
              repository,
            })
          : false;

        return { repository, allowed, canConfigure };
      }),
    );
    const repositoryIds = new Set<string>(
      discovered.status === "ready" ? [...discovered.repositoryIds] : [],
    );
    const directConfigRepositoryIds = new Set<string>(
      discovered.status === "ready"
        ? [...discovered.directConfigRepositoryIds]
        : [],
    );
    const workspaceIds = new Set<string>(
      discovered.status === "ready" ? discovered.workspaceIds : [],
    );

    for (const item of allowed) {
      if (!item.allowed) continue;
      repositoryIds.add(item.repository.id);
      workspaceIds.add(item.repository.workspaceId);
      if (item.canConfigure) {
        directConfigRepositoryIds.add(item.repository.id);
      }
    }

    return {
      status: discovered.status,
      workspaceIds: [...workspaceIds],
      repositoryIds,
      directConfigRepositoryIds,
      checkedAt: discovered.checkedAt,
      ...(discovered.errorCode ? { errorCode: discovered.errorCode } : {}),
    };
  };
}

export const listDashboardRepositoryAccess =
  createDashboardRepositoryAccessLoader({
    getPrisma,
    listAccess: listGitHubUserRepositoryAccess,
    canMutate: canDashboardActorMutateRepository,
    canConfigure: canDashboardActorConfigureRepository,
  });

function dedupeRepositoryAccessCandidates<T extends { readonly id: string }>(
  repositories: readonly T[],
): T[] {
  return [
    ...new Map(
      repositories.map((repository) => [repository.id, repository]),
    ).values(),
  ];
}

function emptyDashboardRepositoryAccess(
  status: GitHubUserRepositoryAccessStatus = "ready",
): DashboardRepositoryAccessScope {
  return {
    status,
    workspaceIds: [],
    repositoryIds: new Set<string>(),
    directConfigRepositoryIds: new Set<string>(),
    checkedAt: null,
  };
}

export function normalizeRequestedRepositoryFullName(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function dashboardRepositoryVisibilityChanged(
  previous: DashboardRepositoryAccessScope,
  next: DashboardRepositoryAccessScope,
): boolean {
  return (
    previous.workspaceIds.length !== next.workspaceIds.length ||
    previous.repositoryIds.size !== next.repositoryIds.size ||
    previous.workspaceIds.some(
      (workspaceId) => !next.workspaceIds.includes(workspaceId),
    ) ||
    [...previous.repositoryIds].some(
      (repositoryId) => !next.repositoryIds.has(repositoryId),
    )
  );
}
