import type {
  GitHubRepositorySnapshot,
  RepositoryConnectionSummary,
  RepositorySyncResult,
} from "../../domain/repository-connection";

import type { RepositorySyncPolicy } from "../../domain/repository-sync-policy";

export type RepositoryInventorySyncResult = RepositorySyncResult & {
  readonly synchronizedRepositories: readonly GitHubRepositorySnapshot[];
};

export interface RepositoryConnectionRepositoryPort {
  beginInstallationInventory(): Promise<bigint>;

  syncInstallationRepositories(input: {
    githubInstallationId: string;
    repositories: readonly GitHubRepositorySnapshot[];
    syncedAt: Date;
    inventoryGeneration: bigint;
    syncPolicy?: RepositorySyncPolicy;
  }): Promise<RepositoryInventorySyncResult>;

  listWorkspaceRepositories(
    workspaceId: string,
  ): Promise<readonly RepositoryConnectionSummary[]>;
}
