import type { PrismaClient } from "@reviewrouter/platform-db";
import { repositoryPermissionAllowsRepoManagement } from "./dashboard-access-policy";
import {
  clearEmptyRepositoryAccessCacheForUser,
  repositoryAccessCacheTtlMs,
  readFreshRepositoryPermissionCache,
  replaceRepositoryPermissionCache,
  updateRepositoryPermissionCacheObservation,
} from "./github-repository-permission-cache";
import {
  getValidGitHubUserAccessToken,
  revokeGitHubUserAuthorization,
  resolveGitHubUserAuthorizationAppSlug,
  type GitHubUserAuthorizationAuthority,
} from "./github-user-authorization";

const githubApiBaseUrl = "https://api.github.com";
const githubApiVersion = "2022-11-28";

export type GitHubUserRepositoryAccessStatus =
  | "ready"
  | "token_missing"
  | "token_revoked"
  | "token_expired"
  | "token_refresh_failed"
  | "token_decryption_failed"
  | "token_encryption_misconfigured"
  | "github_error";

export type GitHubUserRepositoryAccessScope = {
  readonly status: GitHubUserRepositoryAccessStatus;
  readonly workspaceIds: readonly string[];
  readonly repositoryIds: ReadonlySet<string>;
  readonly directConfigRepositoryIds: ReadonlySet<string>;
  readonly checkedAt: Date | null;
  readonly errorCode?: string;
};

export type GitHubUserRepositoryAccessActor = {
  readonly userId: string;
  readonly githubUserId: string;
  readonly githubLogin: string;
};

type FetchLike = typeof fetch;
type RepositoryAccessEnvironment = {
  readonly [key: string]: string | undefined;
};

type GitHubUserInstallation = {
  readonly id: number | string;
};

type GitHubUserRepository = {
  readonly id: number | string;
  readonly permissions?: {
    readonly admin?: boolean;
    readonly maintain?: boolean;
    readonly push?: boolean;
    readonly pull?: boolean;
  };
};

export async function listGitHubUserRepositoryAccess(input: {
  readonly prisma: PrismaClient;
  readonly actor: GitHubUserRepositoryAccessActor;
  readonly excludedWorkspaceIds?: readonly string[];
  readonly env?: RepositoryAccessEnvironment;
  readonly now?: Date;
  readonly fetch?: FetchLike;
}): Promise<GitHubUserRepositoryAccessScope> {
  const now = input.now ?? new Date();
  const cached = await readFreshRepositoryPermissionCache({
    prisma: input.prisma,
    userId: input.actor.userId,
    excludedWorkspaceIds: input.excludedWorkspaceIds ?? [],
    now,
    appSlug: resolveGitHubUserAuthorizationAppSlug(input.env),
  });
  if (cached.checkedAt) {
    return {
      status: "ready",
      workspaceIds: cached.workspaceIds,
      repositoryIds: cached.repositoryIds,
      directConfigRepositoryIds: cached.directConfigRepositoryIds,
      checkedAt: cached.checkedAt,
    };
  }

  return refreshGitHubUserRepositoryAccess(input);
}

export async function refreshGitHubUserRepositoryAccess(input: {
  readonly prisma: PrismaClient;
  readonly actor: GitHubUserRepositoryAccessActor;
  readonly excludedWorkspaceIds?: readonly string[];
  readonly env?: RepositoryAccessEnvironment;
  readonly now?: Date;
  readonly fetch?: FetchLike;
}): Promise<GitHubUserRepositoryAccessScope> {
  const now = input.now ?? new Date();
  clearEmptyRepositoryAccessCacheForUser(input.actor.userId);
  const token = await getValidGitHubUserAccessToken({
    prisma: input.prisma,
    userId: input.actor.userId,
    now,
    ...(input.env ? { env: input.env } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });
  if (token.status !== "ready") {
    return emptyGitHubUserRepositoryAccess({
      status: userTokenStatusToRepositoryAccessStatus(token.status),
      ...(token.errorCode ? { errorCode: token.errorCode } : {}),
    });
  }

  try {
    const userInstallations = await listUserInstallations({
      accessToken: token.accessToken,
      fetch: input.fetch ?? fetch,
    });
    const installationIds = userInstallations.map((installation) =>
      BigInt(installation.id),
    );
    const activeInstallations =
      installationIds.length > 0
        ? await input.prisma.gitHubInstallation.findMany({
            where: {
              githubInstallationId: { in: installationIds },
              status: "active",
              ...(input.excludedWorkspaceIds &&
              input.excludedWorkspaceIds.length > 0
                ? { workspaceId: { notIn: [...input.excludedWorkspaceIds] } }
                : {}),
            },
            select: {
              githubInstallationId: true,
            },
          })
        : [];
    const activeInstallationIds = new Set(
      activeInstallations.map((installation) =>
        installation.githubInstallationId.toString(),
      ),
    );
    const repositoryEntries: {
      readonly githubInstallationId: bigint;
      readonly githubRepositoryId: bigint;
      readonly permission: string | null;
      readonly canManage: boolean;
    }[] = [];

    for (const installation of userInstallations) {
      const installationId = installation.id.toString();
      if (!activeInstallationIds.has(installationId)) continue;

      const repositories = await listUserInstallationRepositories({
        installationId,
        accessToken: token.accessToken,
        fetch: input.fetch ?? fetch,
      });
      for (const repository of repositories) {
        const permission = repositoryPermissionFromGitHub(repository);
        repositoryEntries.push({
          githubInstallationId: BigInt(installationId),
          githubRepositoryId: BigInt(repository.id),
          permission,
          canManage: repositoryPermissionAllowsDashboardMutation(permission),
        });
      }
    }

    const connectedRepositories =
      repositoryEntries.length > 0
        ? await input.prisma.repositoryConnection.findMany({
            where: {
              provider: "github",
              githubRepositoryId: {
                in: repositoryEntries.map((entry) => entry.githubRepositoryId),
              },
              selected: true,
              archived: false,
              installation: {
                status: "active",
              },
            },
            select: {
              id: true,
              githubRepositoryId: true,
              installation: {
                select: {
                  githubInstallationId: true,
                },
              },
            },
          })
        : [];
    const connectedByKey = new Map(
      connectedRepositories.flatMap((repository) =>
        repository.githubRepositoryId && repository.installation
          ? [
              [
                repositoryAccessEntryKey({
                  githubInstallationId:
                    repository.installation.githubInstallationId,
                  githubRepositoryId: repository.githubRepositoryId,
                }),
                repository,
              ] as const,
            ]
          : [],
      ),
    );
    const checkedAt = now;
    const expiresAt = new Date(now.getTime() + repositoryAccessCacheTtlMs);
    const cacheRows = repositoryEntries.flatMap((entry) => {
      const repository = connectedByKey.get(repositoryAccessEntryKey(entry));
      if (!repository) return [];

      return [
        {
          userId: input.actor.userId,
          repositoryId: repository.id,
          githubInstallationId: entry.githubInstallationId,
          permission: entry.permission,
          roleName: null,
          canManage: entry.canManage,
          checkedAt,
          expiresAt,
        },
      ];
    });

    const published = await replaceRepositoryPermissionCache({
      prisma: input.prisma,
      userId: input.actor.userId,
      authority: token.authority,
      rows: cacheRows,
      excludedWorkspaceIds: input.excludedWorkspaceIds ?? [],
      now,
    });
    if (!published)
      return emptyGitHubUserRepositoryAccess({
        status: "token_refresh_failed",
        errorCode: "github_user_authorization_changed",
      });

    return {
      status: "ready",
      ...(await readFreshRepositoryPermissionCache({
        prisma: input.prisma,
        userId: input.actor.userId,
        excludedWorkspaceIds: input.excludedWorkspaceIds ?? [],
        now,
        appSlug: token.authority.appSlug,
      })),
    };
  } catch (error) {
    const status = githubUserApiStatus(error);
    if (status === 401) {
      const revoked = await revokeGitHubUserAuthorization({
        prisma: input.prisma,
        githubUserId: input.actor.githubUserId,
        errorCode: "github_user_token_bad_credentials",
        authority: token.authority,
        ...(input.env ? { env: input.env } : {}),
      });
      return emptyGitHubUserRepositoryAccess({
        status: revoked ? "token_revoked" : "token_refresh_failed",
        errorCode: revoked
          ? "github_user_token_bad_credentials"
          : "github_user_authorization_changed",
      });
    }

    return emptyGitHubUserRepositoryAccess({
      status: "github_error",
      errorCode: status ? `github_user_api_${status}` : "github_user_api_error",
    });
  }
}

export async function updateRepositoryPermissionCacheFromLiveCheck(input: {
  readonly prisma: PrismaClient;
  readonly actor: GitHubUserRepositoryAccessActor;
  readonly authority: GitHubUserAuthorizationAuthority | null;
  readonly repositoryId: string;
  readonly githubInstallationId: string | bigint | number;
  readonly permission: string;
  readonly roleName: string;
  readonly canManage: boolean;
  readonly now?: Date;
}): Promise<void> {
  if (!input.authority) return;
  clearEmptyRepositoryAccessCacheForUser(input.actor.userId);
  await updateRepositoryPermissionCacheObservation({
    ...input,
    authority: input.authority,
    userId: input.actor.userId,
    now: input.now ?? new Date(),
  });
}

export function repositoryPermissionAllowsDashboardMutation(
  permission: string | null,
): boolean {
  return repositoryPermissionAllowsRepoManagement({ permission });
}

function repositoryPermissionFromGitHub(
  repository: GitHubUserRepository,
): string | null {
  if (repository.permissions?.admin) return "admin";
  if (repository.permissions?.maintain) return "maintain";
  if (repository.permissions?.push) return "write";
  if (repository.permissions?.pull) return "read";
  return null;
}

async function listUserInstallations(input: {
  readonly accessToken: string;
  readonly fetch: FetchLike;
}): Promise<readonly GitHubUserInstallation[]> {
  const installations: GitHubUserInstallation[] = [];
  for (let page = 1; ; page += 1) {
    const payload = await fetchGitHubUserJson<{
      readonly installations?: readonly GitHubUserInstallation[];
    }>({
      path: "/user/installations",
      page,
      accessToken: input.accessToken,
      fetch: input.fetch,
    });
    const pageItems = payload.installations ?? [];
    installations.push(...pageItems);
    if (pageItems.length < 100) break;
  }

  return installations;
}

async function listUserInstallationRepositories(input: {
  readonly installationId: string;
  readonly accessToken: string;
  readonly fetch: FetchLike;
}): Promise<readonly GitHubUserRepository[]> {
  const repositories: GitHubUserRepository[] = [];
  for (let page = 1; ; page += 1) {
    const payload = await fetchGitHubUserJson<{
      readonly repositories?: readonly GitHubUserRepository[];
    }>({
      path: `/user/installations/${input.installationId}/repositories`,
      page,
      accessToken: input.accessToken,
      fetch: input.fetch,
    });
    const pageItems = payload.repositories ?? [];
    repositories.push(...pageItems);
    if (pageItems.length < 100) break;
  }

  return repositories;
}

async function fetchGitHubUserJson<T>(input: {
  readonly path: string;
  readonly page: number;
  readonly accessToken: string;
  readonly fetch: FetchLike;
}): Promise<T> {
  const url = new URL(input.path, githubApiBaseUrl);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(input.page));

  const response = await input.fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.accessToken}`,
      "User-Agent": "ReviewRouter",
      "X-GitHub-Api-Version": githubApiVersion,
    },
  });
  if (!response.ok) {
    throw new GitHubUserApiError(response.status);
  }

  return (await response.json()) as T;
}

function userTokenStatusToRepositoryAccessStatus(
  status: Exclude<
    Awaited<ReturnType<typeof getValidGitHubUserAccessToken>>["status"],
    "ready"
  >,
): GitHubUserRepositoryAccessStatus {
  if (status === "missing") return "token_missing";
  if (status === "revoked") return "token_revoked";
  if (status === "expired") return "token_expired";
  if (status === "refresh_failed") return "token_refresh_failed";
  if (status === "token_decryption_failed") return "token_decryption_failed";
  return "token_encryption_misconfigured";
}

function emptyGitHubUserRepositoryAccess(input: {
  readonly status: GitHubUserRepositoryAccessStatus;
  readonly errorCode?: string;
}): GitHubUserRepositoryAccessScope {
  return {
    status: input.status,
    workspaceIds: [],
    repositoryIds: new Set<string>(),
    directConfigRepositoryIds: new Set<string>(),
    checkedAt: null,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

function repositoryAccessEntryKey(input: {
  readonly githubInstallationId: bigint;
  readonly githubRepositoryId: bigint;
}): string {
  return `${input.githubInstallationId.toString()}:${input.githubRepositoryId.toString()}`;
}

function githubUserApiStatus(error: unknown): number | null {
  if (error instanceof GitHubUserApiError) return error.status;
  return null;
}

class GitHubUserApiError extends Error {
  constructor(readonly status: number) {
    super(`github_user_api_error:${status}`);
  }
}
