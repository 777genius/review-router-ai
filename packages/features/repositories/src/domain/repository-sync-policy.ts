import type { GitHubRepositorySnapshot } from "./repository-connection";

export type RepositorySyncPolicy = {
  readonly maxRepositories: number;
};

export type RepositorySyncPolicyResult = {
  readonly repositories: readonly GitHubRepositorySnapshot[];
  readonly skippedDueToLimit: number;
};

export function applyRepositorySyncPolicy(
  repositories: readonly GitHubRepositorySnapshot[],
  policy?: RepositorySyncPolicy,
  admittedRepositoryIds: ReadonlySet<string> = new Set(),
): RepositorySyncPolicyResult {
  if (!policy) {
    return { repositories, skippedDueToLimit: 0 };
  }

  const maxRepositories = Math.max(0, Math.floor(policy.maxRepositories));
  if (repositories.length <= maxRepositories) {
    return { repositories, skippedDueToLimit: 0 };
  }

  const admittedCount = repositories.filter((repository) =>
    admittedRepositoryIds.has(repository.githubRepositoryId),
  ).length;
  if (admittedCount > maxRepositories) {
    throw new Error("repository_sync_quota_below_current_selection");
  }
  const selectedRepositories = [...repositories]
    .sort(
      (left, right) =>
        Number(admittedRepositoryIds.has(right.githubRepositoryId)) -
          Number(admittedRepositoryIds.has(left.githubRepositoryId)) ||
        left.fullName.localeCompare(right.fullName),
    )
    .slice(0, maxRepositories);

  return {
    repositories: selectedRepositories,
    skippedDueToLimit: repositories.length - selectedRepositories.length,
  };
}
