import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OctokitGitHubRepositorySource } from "../infrastructure/github/octokit-github-repository-source";
import { syncInstallationRepositories } from "../application/use-cases/sync-installation-repositories";
import type { RepositoryConnectionRepositoryPort } from "../application/ports/repository-connection-repository-port";

const mocks = vi.hoisted(() => ({
  request:
    vi.fn<
      (
        route: string,
        input: { page: number; request: { signal: AbortSignal } },
      ) => Promise<{ data: { repositories: ReturnType<typeof repository>[] } }>
    >(),
  installation: vi.fn(),
}));

vi.mock("@octokit/app", () => ({
  App: class {
    async getInstallationOctokit(id: number) {
      mocks.installation(id);
      return { request: mocks.request };
    }
  },
}));

describe("complete GitHub installation inventory", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.useRealTimers());

  it("returns every page and preserves existing repository normalization", async () => {
    mocks.request
      .mockResolvedValueOnce(page(1, 100))
      .mockResolvedValueOnce(page(101, 100))
      .mockResolvedValueOnce({
        data: {
          repositories: [
            {
              ...repository(201),
              private: true,
              default_branch: null,
              stargazers_count: undefined,
              watchers_count: 7,
            },
          ],
        },
      });
    const source = inventory();
    const result = await source.listInstallationRepositories("42");
    expect(result).toHaveLength(201);
    expect(result[200]).toEqual({
      githubRepositoryId: "201",
      owner: "acme",
      name: "repository-201",
      fullName: "acme/repository-201",
      defaultBranch: "main",
      visibility: "private",
      archived: false,
      stargazersCount: 7,
    });
    expect(mocks.request.mock.calls.map(([, input]) => input.page)).toEqual([
      1, 2, 3,
    ]);
    expect(mocks.installation).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("does not commit a partial inventory or identities when page two fails", async () => {
    mocks.request
      .mockResolvedValueOnce(page(1, 100))
      .mockRejectedValueOnce(new Error("page two unavailable"));
    const store = repositoryStore();
    const identities = {
      synchronizeRepositoryIdentities: vi.fn(async () => undefined),
    };
    await expect(
      syncInstallationRepositories("42", {
        github: inventory(),
        repositories: store,
        clock: { now: () => new Date() },
        repositoryIdentities: identities,
      }),
    ).rejects.toThrow("page two unavailable");
    expect(store.beginInstallationInventory).toHaveBeenCalledTimes(1);
    expect(store.syncInstallationRepositories).not.toHaveBeenCalled();
    expect(identities.synchronizeRepositoryIdentities).not.toHaveBeenCalled();

    mocks.request.mockResolvedValueOnce(page(1, 2));
    await syncInstallationRepositories("42", {
      github: inventory(),
      repositories: store,
      clock: { now: () => new Date() },
    });
    expect(store.syncInstallationRepositories).toHaveBeenCalledTimes(1);
  });

  it("bounds a complete pass even when each individual page finishes", async () => {
    vi.useFakeTimers();
    mocks.request.mockImplementation(async (_, input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return page(input.page * 100, 100);
    });
    const source = inventory(35);
    const call = source.listInstallationRepositories("42");
    const timedOut = expect(call).rejects.toThrow("operation_deadline");
    await vi.advanceTimersByTimeAsync(35);
    await timedOut;
    expect(mocks.request).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(20);
    expect(mocks.request).toHaveBeenCalledTimes(4);
    mocks.request.mockResolvedValueOnce(page(1, 1));
    await expect(
      source.listInstallationRepositories("42"),
    ).resolves.toHaveLength(1);
  });

  it("retains ignored-abort requests and prevents a late page from continuing or committing", async () => {
    vi.useFakeTimers();
    const held = deferred<{
      data: { repositories: ReturnType<typeof repository>[] };
    }>();
    mocks.request.mockReturnValue(held.promise);
    const source = inventory(20);
    const store = repositoryStore();
    const sync = syncInstallationRepositories("42", {
      github: source,
      repositories: store,
      clock: { now: () => new Date() },
    });
    const first = expect(sync).rejects.toThrow("operation_deadline");
    await vi.advanceTimersByTimeAsync(20);
    await first;
    const second = expect(
      source.listInstallationRepositories("43"),
    ).rejects.toThrow("operation_deadline");
    await vi.advanceTimersByTimeAsync(20);
    await second;
    await expect(source.listInstallationRepositories("44")).rejects.toThrow(
      "operation_capacity",
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(
      mocks.request.mock.calls.every(
        ([, input]) => input.request.signal.aborted,
      ),
    ).toBe(true);
    held.resolve(page(1, 100));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(store.syncInstallationRepositories).not.toHaveBeenCalled();
    mocks.request.mockResolvedValueOnce(page(1, 1));
    await expect(
      source.listInstallationRepositories("44"),
    ).resolves.toHaveLength(1);
  });
});

function inventory(inventoryTimeoutMs = 1_000) {
  return new OctokitGitHubRepositorySource({
    appId: 1,
    privateKey: "fixture",
    inventoryTimeoutMs,
  });
}

function repository(id: number) {
  return {
    id,
    name: `repository-${id}`,
    full_name: `acme/repository-${id}`,
    owner: { login: "acme" },
    default_branch: "main" as string | null,
    private: false,
    archived: false,
    stargazers_count: 1 as number | undefined,
    watchers_count: 0,
  };
}

function page(first: number, count: number) {
  return {
    data: {
      repositories: Array.from({ length: count }, (_, index) =>
        repository(first + index),
      ),
    },
  };
}

function repositoryStore() {
  return {
    beginInstallationInventory: vi.fn(async () => 1n),
    syncInstallationRepositories: vi.fn(
      async (
        input: Parameters<
          RepositoryConnectionRepositoryPort["syncInstallationRepositories"]
        >[0],
      ) => ({
        installationId: "42",
        seen: input.repositories.length,
        upserted: input.repositories.length,
        unselected: 0,
        skippedDueToLimit: 0,
        synchronizedRepositories: input.repositories,
      }),
    ),
    listWorkspaceRepositories: vi.fn(async () => []),
  } satisfies RepositoryConnectionRepositoryPort;
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
