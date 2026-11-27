import { applyRepositorySyncPolicy } from "../domain/repository-sync-policy";
import { describe, expect, it } from "vitest";
import type { Clock } from "@reviewrouter/shared";
import type { GitHubRepositorySnapshot } from "../domain/repository-connection";
import type { GitHubRepositorySourcePort } from "../application/ports/github-repository-source-port";
import type {
  RepositoryConnectionRepositoryPort,
  RepositoryInventorySyncResult,
} from "../application/ports/repository-connection-repository-port";
import type { RepositoryIdentitySynchronizationPort } from "../application/ports/repository-identity-synchronization-port";
import { syncInstallationRepositories } from "../application/use-cases/sync-installation-repositories";

class StaticGitHubSource implements GitHubRepositorySourcePort {
  constructor(
    private readonly repositories: readonly GitHubRepositorySnapshot[],
  ) {}

  async listInstallationRepositories(): Promise<
    readonly GitHubRepositorySnapshot[]
  > {
    return this.repositories;
  }
}

class CapturingRepositoryStore implements RepositoryConnectionRepositoryPort {
  public lastInput:
    | Parameters<
        RepositoryConnectionRepositoryPort["syncInstallationRepositories"]
      >[0]
    | null = null;

  async beginInstallationInventory() {
    return 1n;
  }

  async syncInstallationRepositories(
    input: Parameters<
      RepositoryConnectionRepositoryPort["syncInstallationRepositories"]
    >[0],
  ): Promise<RepositoryInventorySyncResult> {
    this.lastInput = input;
    const selection = applyRepositorySyncPolicy(
      input.repositories,
      input.syncPolicy,
    );
    return {
      installationId: input.githubInstallationId,
      seen: input.repositories.length,
      upserted: selection.repositories.length,
      unselected: 0,
      skippedDueToLimit: selection.skippedDueToLimit,
      synchronizedRepositories: selection.repositories,
    };
  }

  async listWorkspaceRepositories() {
    return [];
  }
}

const fixedClock: Clock = {
  now: () => new Date("2026-05-03T15:00:00.000Z"),
};

describe("syncInstallationRepositories", () => {
  it("fetches installation repos and persists one sync batch", async () => {
    const repositories = [
      {
        githubRepositoryId: "1",
        owner: "777genius",
        name: "review-router",
        fullName: "777genius/review-router",
        defaultBranch: "main",
        visibility: "public",
        archived: false,
        stargazersCount: 42,
      } satisfies GitHubRepositorySnapshot,
    ];
    const store = new CapturingRepositoryStore();

    const result = await syncInstallationRepositories("129154876", {
      github: new StaticGitHubSource(repositories),
      repositories: store,
      clock: fixedClock,
    });

    expect(result).toEqual({
      installationId: "129154876",
      seen: 1,
      upserted: 1,
      unselected: 0,
      skippedDueToLimit: 0,
    });
    expect(store.lastInput?.syncedAt.toISOString()).toBe(
      "2026-05-03T15:00:00.000Z",
    );
  });

  it("synchronizes durable repository identities after persisting connections", async () => {
    const repositories = [repositorySnapshot("1", "alpha")];
    const store = new CapturingRepositoryStore();
    const calls: Parameters<
      RepositoryIdentitySynchronizationPort["synchronizeRepositoryIdentities"]
    >[0][] = [];

    await syncInstallationRepositories("129154876", {
      github: new StaticGitHubSource(repositories),
      repositories: store,
      repositoryIdentities: {
        async synchronizeRepositoryIdentities(input) {
          calls.push(input);
        },
      },
      clock: fixedClock,
    });

    expect(calls).toEqual([
      {
        githubInstallationId: "129154876",
        repositories,
        syncedAt: new Date("2026-05-03T15:00:00.000Z"),
      },
    ]);
  });

  it("passes full inventory and quota to the persistence admission boundary", async () => {
    const repositories = [
      repositorySnapshot("3", "zeta"),
      repositorySnapshot("1", "alpha"),
      repositorySnapshot("2", "beta"),
    ];
    const store = new CapturingRepositoryStore();

    const result = await syncInstallationRepositories("129154876", {
      github: new StaticGitHubSource(repositories),
      repositories: store,
      clock: fixedClock,
      syncPolicy: { maxRepositories: 2 },
    });

    expect(result).toEqual({
      installationId: "129154876",
      seen: 3,
      upserted: 2,
      unselected: 0,
      skippedDueToLimit: 1,
    });
    expect(store.lastInput?.repositories.map((repo) => repo.fullName)).toEqual([
      "777genius/zeta",
      "777genius/alpha",
      "777genius/beta",
    ]);
    expect(store.lastInput?.syncPolicy).toEqual({ maxRepositories: 2 });
  });
});

describe("stable quota admission", () => {
  it("retains admitted repositories when an alphabetically earlier one appears", () => {
    const rows = [
      repositorySnapshot("1", "alpha"),
      repositorySnapshot("2", "beta"),
      repositorySnapshot("3", "zeta"),
    ];
    const retained = applyRepositorySyncPolicy(
      rows,
      { maxRepositories: 2 },
      new Set(["2", "3"]),
    );
    expect(retained.repositories.map((row) => row.githubRepositoryId)).toEqual([
      "2",
      "3",
    ]);
    expect(retained.skippedDueToLimit).toBe(1);
  });
  it("fills a vacated slot deterministically and refuses a destructive cap reduction", () => {
    const rows = [
      repositorySnapshot("3", "zeta"),
      repositorySnapshot("1", "alpha"),
      repositorySnapshot("2", "beta"),
    ];
    expect(
      applyRepositorySyncPolicy(
        rows,
        { maxRepositories: 2 },
        new Set(["3"]),
      ).repositories.map((row) => row.githubRepositoryId),
    ).toEqual(["3", "1"]);
    expect(() =>
      applyRepositorySyncPolicy(
        rows,
        { maxRepositories: 1 },
        new Set(["2", "3"]),
      ),
    ).toThrow("repository_sync_quota_below_current_selection");
  });
});

function repositorySnapshot(
  githubRepositoryId: string,
  name: string,
): GitHubRepositorySnapshot {
  return {
    githubRepositoryId,
    owner: "777genius",
    name,
    fullName: `777genius/${name}`,
    defaultBranch: "main",
    visibility: "public",
    archived: false,
    stargazersCount: 0,
  };
}
