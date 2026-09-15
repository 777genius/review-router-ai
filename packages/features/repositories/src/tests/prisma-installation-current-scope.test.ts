import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaRepositoryConnectionRepository } from "../infrastructure/prisma/prisma-repository-connection-repository";
import { PrismaGitHubInstallationRepository } from "../../../github-installations/src/infrastructure/prisma/prisma-github-installation-repository";

function fixture() {
  const events: string[] = [];
  const guarded = (name: string, value: unknown) =>
    vi.fn(async () => {
      events.push(name);
      return value;
    });
  const tx = {
    $queryRaw: vi.fn(async (sql: Prisma.Sql | TemplateStringsArray) => {
      const text = "text" in sql ? sql.text : Array.from(sql).join("?");
      if (text.includes('UPDATE "ScmRepositoryIdentity"')) {
        events.push("identity-rotate");
        return [{ version: 2 }];
      }
      if (text.includes("transaction_timestamp()")) {
        events.push("identity-time");
        return [{ fencedAt: new Date("2026-09-14T00:00:00.000Z") }];
      }
      events.push("guard");
      expect(text).toContain("pg_advisory_xact_lock(");
      expect("values" in sql ? sql.values : []).toEqual([
        createHash("sha256")
          .update("review-current-scope-v1\0global")
          .digest("hex"),
      ]);
      return [{ locked: 1 }];
    }),
    gitHubInstallation: {
      findUnique: guarded("installation-read", {
        id: "installation",
        workspaceId: "destination",
        status: "active",
      }),
      upsert: guarded("installation-upsert", {}),
      update: guarded("installation-remove", {}),
    },
    workspace: {
      update: guarded("workspace-update", {}),
      upsert: guarded("workspace-upsert", { id: "destination" }),
    },
    repositoryPermissionCache: {
      deleteMany: guarded("cache-delete", { count: 2 }),
    },
    repositoryConnection: {
      findUnique: guarded("repository-read", null),
      findMany: guarded("removal-read", []),
      upsert: guarded("repository-upsert", { id: "repository" }),
      updateMany: guarded("unselect", { count: 2 }),
    },
    scmRepositoryIdentity: {
      updateMany: guarded("identity-rotate", { count: 1 }),
    },
    workflowProvisioning: {
      findUnique: guarded("provisioning-read", null),
      create: guarded("provisioning-create", {}),
      updateMany: guarded("provisioning-invalidate", { count: 1 }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      events.push("begin");
      // Each retry/unit gets an authentic distinct transaction lifetime.
      const value = await work({ ...tx });
      events.push("commit");
      return value;
    }),
  };
  return {
    events,
    tx,
    prisma,
    inventory: new PrismaRepositoryConnectionRepository(prisma as never),
    installations: new PrismaGitHubInstallationRepository(prisma as never),
  };
}
const snapshot = {
  githubInstallationId: "123",
  accountLogin: "test",
  accountType: "Organization",
  repositorySelection: "all",
  status: "active" as const,
};
const input = {
  githubInstallationId: "123",
  inventoryGeneration: 2n,
  syncedAt: new Date(),
  repositories: [
    {
      githubRepositoryId: "456",
      owner: "test",
      name: "repo",
      fullName: "test/repo",
      defaultBranch: "main",
      visibility: "private" as const,
      archived: false,
      stargazersCount: 0,
    },
  ],
};

describe("actual installation/inventory current-scope writers", () => {
  it("guards upsert before workspace discovery and cache invalidation, including absence", async () => {
    const f = fixture();
    f.tx.gitHubInstallation.findUnique.mockImplementation(async () => {
      f.events.push("installation-read");
      return null;
    });
    await f.installations.upsertInstallation(snapshot);
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "workspace-upsert",
      "installation-upsert",
      "cache-delete",
      "commit",
    ]);
  });
  it("guards existing installation updates before reads", async () => {
    const f = fixture();
    await f.installations.upsertInstallation(snapshot);
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "workspace-update",
      "installation-upsert",
      "cache-delete",
      "commit",
    ]);
  });
  it.each([
    ["suspension", "active", "suspended"],
    ["reactivation", "suspended", "active"],
  ])(
    "rotates repository identity on installation %s",
    async (_name, before, after) => {
      const f = fixture();
      f.tx.gitHubInstallation.findUnique.mockResolvedValueOnce({
        id: "installation",
        workspaceId: "destination",
        status: before,
      });
      f.tx.repositoryConnection.findMany.mockResolvedValueOnce([
        {
          id: "repository",
          workspaceId: "destination",
          scmRepositoryIdentityId: "identity-1",
        },
      ]);

      await f.installations.upsertInstallation({
        ...snapshot,
        status: after as "active" | "suspended",
      });

      expect(f.events.indexOf("identity-rotate")).toBeGreaterThan(
        f.events.indexOf("installation-upsert"),
      );
      expect(f.events.indexOf("identity-rotate")).toBeLessThan(
        f.events.indexOf("commit"),
      );
    },
  );
  it("keeps uninstall fanout and cache invalidation in the same guarded transaction", async () => {
    const f = fixture();
    await f.installations.markInstallationRemoved("123");
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "identity-time",
      "removal-read",
      "installation-remove",
      "unselect",
      "cache-delete",
      "commit",
    ]);
    expect(f.tx.repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: { installationId: "installation" },
      data: { selected: false },
    });
  });
  it("guards missing uninstall and preserves its no-op", async () => {
    const f = fixture();
    f.tx.gitHubInstallation.findUnique.mockImplementation(async () => {
      f.events.push("installation-read");
      return null;
    });
    await f.installations.markInstallationRemoved("123");
    expect(f.events).toEqual(["begin", "guard", "installation-read", "commit"]);
  });
  it("guards insertion and trailing predicate unselection separately before any reads", async () => {
    const f = fixture();
    expect(await f.inventory.syncInstallationRepositories(input)).toMatchObject(
      { upserted: 1, unselected: 2 },
    );
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "repository-read",
      "repository-upsert",
      "commit",
      "begin",
      "guard",
      "installation-read",
      "removal-read",
      "unselect",
      "commit",
    ]);
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(f.tx.repositoryConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          installationId: "installation",
          selected: true,
          inventoryGeneration: { lt: 2n },
          githubRepositoryId: { notIn: [456n] },
        },
      }),
    );
  });
  it("protects empty inventory unselection and rereads installation inside its transaction", async () => {
    const f = fixture();
    await f.inventory.syncInstallationRepositories({
      ...input,
      repositories: [],
    });
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "removal-read",
      "unselect",
      "commit",
    ]);
  });
  it("rotates a removed identity once and requires another epoch on restore", async () => {
    const f = fixture();
    f.tx.repositoryConnection.findMany.mockResolvedValueOnce([
      {
        id: "repository",
        workspaceId: "destination",
        scmRepositoryIdentityId: "identity-1",
      },
    ]);
    await f.inventory.syncInstallationRepositories({
      ...input,
      repositories: [],
    });
    expect(f.events).toContain("identity-rotate");

    f.tx.repositoryConnection.findUnique.mockResolvedValueOnce({
      id: "repository",
      inventoryGeneration: 2n,
      workspaceId: "destination",
      installationId: "installation",
      fullName: "test/repo",
      selected: false,
      scmRepositoryIdentityId: "identity-1",
    });
    await f.inventory.syncInstallationRepositories({
      ...input,
      inventoryGeneration: 3n,
    });
    expect(
      f.events.filter((event) => event === "identity-rotate"),
    ).toHaveLength(2);
  });
  it("preserves inventory generation replay fence", async () => {
    const f = fixture();
    f.tx.repositoryConnection.findUnique.mockResolvedValue({
      id: "repository",
      inventoryGeneration: 2n,
      workspaceId: "destination",
      installationId: "installation",
    });
    expect(await f.inventory.syncInstallationRepositories(input)).toMatchObject(
      { upserted: 0 },
    );
    expect(f.tx.repositoryConnection.upsert).not.toHaveBeenCalled();
  });
  it("fences an installation mismatch before applying the inventory replay fence", async () => {
    const f = fixture();
    f.tx.repositoryConnection.findUnique.mockImplementation(async () => {
      f.events.push("repository-read");
      return {
        id: "repository",
        inventoryGeneration: 2n,
        workspaceId: "destination",
        installationId: "old-installation",
        selected: true,
        scmRepositoryIdentityId: "identity-1",
      };
    });
    f.tx.repositoryConnection.updateMany.mockImplementationOnce(async () => {
      f.events.push("unselect");
      return { count: 1 };
    });

    await expect(
      f.inventory.syncInstallationRepositories(input),
    ).rejects.toThrow("repository_transfer_reconnect_reselection_required");
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "repository-read",
      "identity-rotate",
      "unselect",
      "provisioning-read",
      "commit",
    ]);
    expect(f.tx.repositoryConnection.upsert).not.toHaveBeenCalled();
  });
  it("guards transfer plus provisioning invalidation before either workspace is touched", async () => {
    const f = fixture();
    f.tx.repositoryConnection.updateMany.mockImplementationOnce(async () => {
      f.events.push("unselect");
      return { count: 1 };
    });
    f.tx.workflowProvisioning.findUnique.mockImplementationOnce(async () => {
      f.events.push("provisioning-read");
      return {
        id: "provisioning-1",
        attemptId: "attempt-1",
        revision: 3,
        status: "configured",
      };
    });
    f.tx.repositoryConnection.findUnique.mockImplementation(async () => {
      f.events.push("repository-read");
      return {
        id: "repository",
        inventoryGeneration: 1n,
        workspaceId: "old",
        installationId: "old-installation",
        selected: true,
        scmRepositoryIdentityId: "identity-1",
      };
    });
    await expect(
      f.inventory.syncInstallationRepositories(input),
    ).rejects.toThrow("repository_transfer_reconnect_reselection_required");
    expect(f.events).toEqual([
      "begin",
      "guard",
      "installation-read",
      "repository-read",
      "identity-rotate",
      "unselect",
      "provisioning-read",
      "provisioning-invalidate",
      "commit",
    ]);
    expect(f.tx.repositoryConnection.upsert).not.toHaveBeenCalled();
    expect(f.events.indexOf("identity-rotate")).toBeLessThan(
      f.events.indexOf("commit"),
    );
    expect(f.tx.repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "repository", selected: true },
      data: { selected: false, lastSyncedAt: input.syncedAt },
    });
    expect(f.tx.workflowProvisioning.updateMany).toHaveBeenCalledWith({
      where: {
        id: "provisioning-1",
        attemptId: "attempt-1",
        revision: 3,
        status: "configured",
      },
      data: expect.objectContaining({
        status: "not_started",
        errorMessage: "repository_transfer_reconnect_reselection_required",
      }),
    });
  });
  it.each([
    ["rename", "test/old-repo", "destination", "installation"],
    ["case change", "Test/repo", "destination", "installation"],
  ])(
    "rotates the durable repository identity epoch on %s",
    async (
      _change,
      previousFullName,
      previousWorkspace,
      previousInstallation,
    ) => {
      const f = fixture();
      f.tx.repositoryConnection.findUnique.mockImplementation(async () => {
        f.events.push("repository-read");
        return {
          id: "repository",
          inventoryGeneration: 1n,
          workspaceId: previousWorkspace,
          installationId: previousInstallation,
          fullName: previousFullName,
          scmRepositoryIdentityId: "identity-1",
        };
      });

      await f.inventory.syncInstallationRepositories(input);

      expect(f.events.indexOf("identity-rotate")).toBeGreaterThan(
        f.events.indexOf("repository-upsert"),
      );
      expect(f.events.indexOf("identity-rotate")).toBeLessThan(
        f.events.indexOf("commit"),
      );
    },
  );
  it("preserves the durable identity epoch for an unchanged repository", async () => {
    const f = fixture();
    f.tx.repositoryConnection.findUnique.mockResolvedValue({
      id: "repository",
      inventoryGeneration: 1n,
      workspaceId: "destination",
      installationId: "installation",
      fullName: "test/repo",
      scmRepositoryIdentityId: "identity-1",
    });

    await f.inventory.syncInstallationRepositories(input);

    expect(f.events).not.toContain("identity-rotate");
  });
  it("rotates again when a repository returns to its previous exact name", async () => {
    const f = fixture();
    f.tx.repositoryConnection.findUnique
      .mockResolvedValueOnce({
        id: "repository",
        inventoryGeneration: 1n,
        workspaceId: "destination",
        installationId: "installation",
        fullName: "test/repo",
        scmRepositoryIdentityId: "identity-1",
      })
      .mockResolvedValueOnce({
        id: "repository",
        inventoryGeneration: 2n,
        workspaceId: "destination",
        installationId: "installation",
        fullName: "test/renamed",
        scmRepositoryIdentityId: "identity-1",
      });
    const renamedAt = new Date("2026-09-14T01:00:00.000Z");
    const restoredAt = new Date("2026-09-14T02:00:00.000Z");

    await f.inventory.syncInstallationRepositories({
      ...input,
      syncedAt: renamedAt,
      inventoryGeneration: 2n,
      repositories: [
        {
          ...input.repositories[0]!,
          name: "renamed",
          fullName: "test/renamed",
        },
      ],
    });
    await f.inventory.syncInstallationRepositories({
      ...input,
      syncedAt: restoredAt,
      inventoryGeneration: 3n,
    });

    expect(
      f.events.filter((event) => event === "identity-rotate"),
    ).toHaveLength(2);
  });
  it("reacquires before retry reads after a serialization conflict", async () => {
    const f = fixture();
    f.tx.repositoryConnection.upsert.mockImplementationOnce(async () => {
      f.events.push("repository-upsert");
      throw new Prisma.PrismaClientKnownRequestError("retry", {
        code: "P2034",
        clientVersion: "7.8.0",
      });
    });
    await f.inventory.syncInstallationRepositories(input);
    expect(f.events.slice(0, 10)).toEqual([
      "begin",
      "guard",
      "installation-read",
      "repository-read",
      "repository-upsert",
      "begin",
      "guard",
      "installation-read",
      "repository-read",
      "repository-upsert",
    ]);
  });
  it.each(["upsert", "remove", "inventory", "empty"])(
    "guard failure stops %s before all reads and writes",
    async (kind) => {
      const f = fixture();
      f.tx.$queryRaw.mockRejectedValue(new Error("lock-failed"));
      const result =
        kind === "upsert"
          ? f.installations.upsertInstallation(snapshot)
          : kind === "remove"
            ? f.installations.markInstallationRemoved("123")
            : f.inventory.syncInstallationRepositories({
                ...input,
                repositories: kind === "empty" ? [] : input.repositories,
              });
      await expect(result).rejects.toThrow("lock-failed");
      expect(f.events).toEqual(["begin"]);
    },
  );
});
