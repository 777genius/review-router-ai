import type { Prisma, PrismaClient } from "@prisma/client";
import {
  withGitHubUserAuthorizationAuthority,
  type GitHubUserAuthorizationAuthority,
} from "./github-user-authorization";
import { repositoryPermissionAllowsDirectConfig } from "./dashboard-access-policy";

export const repositoryAccessCacheTtlMs = 15 * 60_000;
const emptyCache = new Map<
  string,
  { userId: string; checkedAt: Date; expiresAt: number }
>();
const emptyCacheTtlMs = 60_000;
const emptyCacheMaxEntries = 1024;
type CachedScope = {
  readonly workspaceIds: readonly string[];
  readonly repositoryIds: ReadonlySet<string>;
  readonly directConfigRepositoryIds: ReadonlySet<string>;
  readonly checkedAt: Date | null;
};
type Observation = Pick<
  Prisma.RepositoryPermissionCacheCreateManyInput,
  | "userId"
  | "repositoryId"
  | "githubInstallationId"
  | "permission"
  | "roleName"
  | "canManage"
  | "checkedAt"
  | "expiresAt"
>;

export async function readFreshRepositoryPermissionCache(input: {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly appSlug: string;
  readonly excludedWorkspaceIds: readonly string[];
  readonly now: Date;
}): Promise<CachedScope> {
  return (
    (await withGitHubUserAuthorizationAuthority({
      ...input,
      run: async (tx, authority) => {
        const rows = await tx.repositoryPermissionCache.findMany({
          where: {
            userId: input.userId,
            authorizationAppSlug: authority.appSlug,
            authorizationRevision: authority.revision,
            expiresAt: { gt: input.now },
            repository: {
              selected: true,
              archived: false,
              installation: { status: "active" },
              ...(input.excludedWorkspaceIds.length > 0
                ? { workspaceId: { notIn: [...input.excludedWorkspaceIds] } }
                : {}),
            },
          },
          orderBy: { checkedAt: "desc" },
          select: {
            checkedAt: true,
            canManage: true,
            permission: true,
            roleName: true,
            repositoryId: true,
            repository: { select: { workspaceId: true } },
          },
        });
        const key = emptyCacheKey(
          input.userId,
          authority,
          input.excludedWorkspaceIds,
        );
        const empty = emptyCache.get(key);
        if (empty && empty.expiresAt <= input.now.getTime())
          emptyCache.delete(key);
        const manageable = rows.filter((row) => row.canManage);
        return {
          workspaceIds: [
            ...new Set(manageable.map((row) => row.repository.workspaceId)),
          ],
          repositoryIds: new Set(manageable.map((row) => row.repositoryId)),
          directConfigRepositoryIds: new Set(
            manageable
              .filter((row) =>
                repositoryPermissionAllowsDirectConfig({
                  permission: row.permission,
                  roleName: row.roleName,
                }),
              )
              .map((row) => row.repositoryId),
          ),
          checkedAt:
            rows[0]?.checkedAt ??
            (empty && empty.expiresAt > input.now.getTime()
              ? empty.checkedAt
              : null),
        };
      },
    })) ?? {
      workspaceIds: [],
      repositoryIds: new Set(),
      directConfigRepositoryIds: new Set(),
      checkedAt: null,
    }
  );
}

export async function replaceRepositoryPermissionCache(input: {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly authority: GitHubUserAuthorizationAuthority;
  readonly rows: readonly Observation[];
  readonly excludedWorkspaceIds: readonly string[];
  readonly now: Date;
}): Promise<boolean> {
  const published = await withGitHubUserAuthorizationAuthority({
    prisma: input.prisma,
    userId: input.userId,
    appSlug: input.authority.appSlug,
    expectedRevision: input.authority.revision,
    run: async (tx) => {
      await tx.repositoryPermissionCache.deleteMany({
        where: { userId: input.userId },
      });
      if (input.rows.length)
        await tx.repositoryPermissionCache.createMany({
          data: input.rows.map((row) => ({
            ...row,
            authorizationAppSlug: input.authority.appSlug,
            authorizationRevision: input.authority.revision,
          })),
        });
      return true;
    },
  });
  if (published && input.rows.length === 0) {
    if (emptyCache.size >= emptyCacheMaxEntries) {
      const oldest = emptyCache.keys().next().value;
      if (oldest) emptyCache.delete(oldest);
    }
    // Reads recheck durable authority, so even a late local publication cannot
    // restore access after a commit revokes or replaces this generation.
    emptyCache.set(
      emptyCacheKey(input.userId, input.authority, input.excludedWorkspaceIds),
      {
        userId: input.userId,
        checkedAt: input.now,
        expiresAt: input.now.getTime() + emptyCacheTtlMs,
      },
    );
  }
  return published === true;
}

export async function updateRepositoryPermissionCacheObservation(input: {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly authority: GitHubUserAuthorizationAuthority;
  readonly repositoryId: string;
  readonly githubInstallationId: string | bigint | number;
  readonly permission: string;
  readonly roleName: string;
  readonly canManage: boolean;
  readonly now: Date;
}): Promise<void> {
  await withGitHubUserAuthorizationAuthority({
    prisma: input.prisma,
    userId: input.userId,
    appSlug: input.authority.appSlug,
    expectedRevision: input.authority.revision,
    run: async (tx) => {
      const data = {
        authorizationAppSlug: input.authority.appSlug,
        authorizationRevision: input.authority.revision,
        githubInstallationId: BigInt(input.githubInstallationId),
        permission: input.permission || null,
        roleName: input.roleName || null,
        canManage: input.canManage,
        checkedAt: input.now,
        expiresAt: new Date(input.now.getTime() + repositoryAccessCacheTtlMs),
      };
      await tx.repositoryPermissionCache.upsert({
        where: {
          userId_repositoryId: {
            userId: input.userId,
            repositoryId: input.repositoryId,
          },
        },
        update: data,
        create: {
          ...data,
          userId: input.userId,
          repositoryId: input.repositoryId,
        },
      });
    },
  });
}

export function clearEmptyRepositoryAccessCacheForUser(userId: string): void {
  for (const [key, value] of emptyCache)
    if (value.userId === userId) emptyCache.delete(key);
}

function emptyCacheKey(
  userId: string,
  authority: GitHubUserAuthorizationAuthority,
  excluded: readonly string[],
): string {
  return JSON.stringify([
    userId,
    authority.appSlug,
    authority.revision,
    [...excluded].sort(),
  ]);
}
