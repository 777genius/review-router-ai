import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { createRetainedOperationRunner } from "@reviewrouter/shared";
import type { GitHubRepositorySnapshot } from "../../domain/repository-connection";
import type { GitHubRepositorySourcePort } from "../../application/ports/github-repository-source-port";
import { createInventoryHttpTransport } from "./installation-inventory-transport";

export type OctokitGitHubRepositorySourceOptions = {
  readonly appId: number | string;
  readonly privateKey: string;
  readonly requestTimeoutMs?: number;
  readonly inventoryTimeoutMs?: number;
  readonly fetch?: typeof fetch;
};

type InstallationRepository = {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly owner: { readonly login: string };
  readonly default_branch: string | null;
  readonly visibility?: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly stargazers_count?: number | null;
  readonly watchers_count?: number | null;
};

function normalizeVisibility(
  repository: InstallationRepository,
): GitHubRepositorySnapshot["visibility"] {
  if (repository.visibility === "internal") return "internal";
  if (repository.private) return "private";
  return "public";
}

export class OctokitGitHubRepositorySource implements GitHubRepositorySourcePort {
  private readonly app: App;
  private readonly inventories = createRetainedOperationRunner(2);
  private readonly inventoryTimeoutMs: number;

  constructor(options: OctokitGitHubRepositorySourceOptions) {
    this.inventoryTimeoutMs = options.inventoryTimeoutMs ?? 120_000;
    this.app = new App({
      appId: options.appId,
      privateKey: options.privateKey,
      Octokit: Octokit.defaults({
        request: {
          fetch: createInventoryHttpTransport(
            options.fetch ?? fetch,
            options.requestTimeoutMs ?? 15_000,
          ),
        },
      }),
    });
  }

  async listInstallationRepositories(
    githubInstallationId: string,
  ): Promise<readonly GitHubRepositorySnapshot[]> {
    return this.inventories.run(
      (signal) => this.readCompleteInventory(githubInstallationId, signal),
      { timeoutMs: this.inventoryTimeoutMs },
    );
  }

  private async readCompleteInventory(
    githubInstallationId: string,
    signal: AbortSignal,
  ): Promise<readonly GitHubRepositorySnapshot[]> {
    const deadline = performance.now() + this.inventoryTimeoutMs;
    const octokit = await this.app.getInstallationOctokit(
      Number(githubInstallationId),
    );
    const repositories: GitHubRepositorySnapshot[] = [];
    for (let page = 1; ; page += 1) {
      signal.throwIfAborted();
      if (performance.now() >= deadline)
        throw new Error("github_repository_inventory_deadline");
      const response = await octokit.request("GET /installation/repositories", {
        per_page: 100,
        page,
        request: { signal },
      });
      signal.throwIfAborted();
      repositories.push(
        ...(response.data.repositories as InstallationRepository[]).map(
          repositorySnapshot,
        ),
      );
      if (response.data.repositories.length < 100) break;
    }
    signal.throwIfAborted();
    return repositories;
  }
}

function repositorySnapshot(
  repository: InstallationRepository,
): GitHubRepositorySnapshot {
  return {
    githubRepositoryId: String(repository.id),
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch ?? "main",
    visibility: normalizeVisibility(repository),
    archived: repository.archived,
    stargazersCount:
      repository.stargazers_count ?? repository.watchers_count ?? 0,
  };
}
