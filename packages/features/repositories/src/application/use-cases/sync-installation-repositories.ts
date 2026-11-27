import type { Clock } from "@reviewrouter/shared";
import type { RepositorySyncResult } from "../../domain/repository-connection";
import type { RepositorySyncPolicy } from "../../domain/repository-sync-policy";
import type { GitHubRepositorySourcePort } from "../ports/github-repository-source-port";
import type { RepositoryConnectionRepositoryPort } from "../ports/repository-connection-repository-port";
import type { RepositoryIdentitySynchronizationPort } from "../ports/repository-identity-synchronization-port";

export type SyncInstallationRepositoriesDependencies = {
  readonly github: GitHubRepositorySourcePort;
  readonly repositories: RepositoryConnectionRepositoryPort;
  readonly repositoryIdentities?: RepositoryIdentitySynchronizationPort;
  readonly clock: Clock;
  readonly syncPolicy?: RepositorySyncPolicy;
};

export async function syncInstallationRepositories(
  githubInstallationId: string,
  dependencies: SyncInstallationRepositoriesDependencies,
): Promise<RepositorySyncResult> {
  const inventoryGeneration =
    await dependencies.repositories.beginInstallationInventory();
  const syncedAt = dependencies.clock.now();
  const repositories =
    await dependencies.github.listInstallationRepositories(
      githubInstallationId,
    );

  const { synchronizedRepositories, ...result } =
    await dependencies.repositories.syncInstallationRepositories({
      githubInstallationId,
      repositories,
      syncedAt,
      inventoryGeneration,
      ...(dependencies.syncPolicy
        ? { syncPolicy: dependencies.syncPolicy }
        : {}),
    });
  if (dependencies.repositoryIdentities) {
    await dependencies.repositoryIdentities.synchronizeRepositoryIdentities({
      githubInstallationId,
      repositories: synchronizedRepositories,
      syncedAt,
    });
  }

  return {
    ...result,
    seen: repositories.length,
  };
}
