import { describe, expect, it, vi } from "vitest";
import {
  PrismaRepositoryConnectionRepository,
  syncInstallationRepositories,
} from "@reviewrouter/features-repositories";
import {
  createProvisioningPrisma,
  initialCandidate,
  record,
} from "../../../../../packages/features/workflow-provisioning/src/tests/provisioning-prisma-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("repository inventory ownership order", () => {
  it("keeps a delayed I1 snapshot behind the I2 reconnect fence", async () => {
    const state = createProvisioningPrisma({
      ...initialCandidate,
      status: "configured",
    });
    let repository = {
      id: record.repositoryId,
      workspaceId: record.workspaceId,
      installationId: record.installationId,
      inventoryGeneration: 0n,
      selected: true,
      scmRepositoryIdentityId: null,
    };
    let generation = 0n;
    const repositoryConnection = {
      findMany: vi.fn(async () => []),
      ...state.repositoryConnection,
      findUnique: vi.fn(async () => ({ ...repository })),
      upsert: vi.fn(async ({ update }: { update: typeof repository }) => {
        repository = { ...repository, ...update };
        return repository;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id?: string }; data: object }) => {
          if (where.id !== repository.id) return { count: 0 };
          repository = { ...repository, ...data };
          return { count: 1 };
        },
      ),
    };
    const tx = {
      workflowProvisioning: state.workflowProvisioning,
      repositoryConnection,
    };
    const prisma = {
      ...state.prisma,
      repositoryConnection,
      $queryRaw: vi.fn(async () => [{ generation: ++generation }]),
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work({
          ...tx,
          $queryRaw: vi.fn(async () => [{ locked: 1 }]),
          gitHubInstallation: prisma.gitHubInstallation,
        } as typeof tx),
      gitHubInstallation: {
        findUnique: vi.fn(
          async ({ where }: { where: { githubInstallationId: bigint } }) =>
            where.githubInstallationId === 1n
              ? { id: record.installationId, workspaceId: record.workspaceId }
              : { id: "installation_2", workspaceId: "workspace_2" },
        ),
      },
    };
    const store = new PrismaRepositoryConnectionRepository(prisma as never);
    const fetched = deferred();
    const resume = deferred();
    const snapshot = [
      {
        githubRepositoryId: "123",
        owner: "acme",
        name: "widget",
        fullName: "acme/widget",
        defaultBranch: "main",
        visibility: "private" as const,
        archived: false,
        stargazersCount: 0,
      },
    ];
    const old = syncInstallationRepositories("1", {
      repositories: store,
      clock: { now: () => new Date("2099-01-01") },
      github: {
        async listInstallationRepositories() {
          fetched.resolve();
          await resume.promise;
          return snapshot;
        },
      },
    });
    await fetched.promise;
    try {
      await expect(
        syncInstallationRepositories("2", {
          repositories: store,
          clock: { now: () => new Date("2026-01-01") },
          github: {
            async listInstallationRepositories() {
              return snapshot;
            },
          },
        }),
      ).rejects.toThrow("repository_transfer_reconnect_reselection_required");
      const before = { ...repository };
      const provisioningBefore = { ...state.current()! };
      expect(before).toMatchObject({
        workspaceId: record.workspaceId,
        installationId: record.installationId,
        inventoryGeneration: 2n,
        selected: false,
      });
      resume.resolve();
      expect(await old).toMatchObject({ upserted: 0, unselected: 0 });
      expect(repository).toEqual(before);
      expect(state.current()).toEqual(provisioningBefore);
      expect(repositoryConnection.upsert).not.toHaveBeenCalled();
    } finally {
      resume.resolve();
      await old;
    }
  });
});
