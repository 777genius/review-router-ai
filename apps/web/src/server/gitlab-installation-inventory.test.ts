import { describe, expect, it, vi } from "vitest";
import type {
  GitLabBulkProvisionResult,
  GitLabGroupProject,
} from "@reviewrouter/features-gitlab-integration";
import { PrismaGitLabInstallationInventory } from "./gitlab-installation-inventory";

const started = new Date("2026-10-31T10:00:00.000Z");

function project(id: string): GitLabGroupProject {
  return {
    projectId: id,
    fullName: `team/repository-${id}`,
    name: `repository-${id}`,
    defaultBranch: "main",
    webUrl: null,
    visibility: "private",
    archived: false,
  };
}

function provision(): GitLabBulkProvisionResult {
  return {
    protocolVersion: 1,
    requested: 2,
    succeeded: 1,
    failed: 1,
    sharedVariablesConfigured: 0,
    results: [
      {
        projectId: "101",
        status: "fulfilled",
        result: {
          mode: "ci_config_path",
          ciConfigPath: ".gitlab/reviewrouter.yml",
          variablesConfigured: 3,
        },
      },
      {
        projectId: "102",
        status: "rejected",
        error: { code: "gitlab_api_error_403", retryable: false },
      },
    ],
  };
}

function fakePrisma() {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    gitLabInstallation: {
      findUnique: vi.fn(async (): Promise<{ lastInstalledAt: Date | null } | null> => null),
      upsert: vi.fn(async () => ({ id: "installation_1" })),
    },
    repositoryConnection: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async (): Promise<{ id: string; workspaceId: string } | null> => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  };
  const prisma = {
    $queryRaw: vi.fn(async () => [{ requestedAt: started }]),
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { tx, prisma, inventory: new PrismaGitLabInstallationInventory(prisma as never) };
}

function input() {
  return {
    workspaceId: "workspace_1",
    installedByUserId: "user_1",
    sourceBaseUrl: "https://gitlab.com",
    namespacePath: "team",
    sourceKind: "group" as const,
    requestStartedAt: started,
    selectedProjects: [project("101"), project("102")],
    provision: provision(),
  };
}

describe("PrismaGitLabInstallationInventory", () => {
  it("checks foreign ownership on the exact issuer and project list", async () => {
    const f = fakePrisma();
    f.tx.repositoryConnection.findFirst.mockResolvedValueOnce({ id: "other" });
    // The read is outside the transaction. The transaction still rechecks to
    // prevent a concurrent owner change between preflight and commit.
    const findFirst = vi.fn().mockResolvedValue({ id: "foreign-repo" });
    const inventory = new PrismaGitLabInstallationInventory({
      ...f.prisma,
      repositoryConnection: { findFirst },
    } as never);
    await expect(
      inventory.assertProjectsNotOwned({
        workspaceId: "workspace_1",
        sourceBaseUrl: "https://gitlab.example",
        projectIds: ["101", "101", "102"],
      }),
    ).rejects.toThrow("gitlab_repository_already_owned");
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        provider: "gitlab",
        sourceBaseUrl: "https://gitlab.example",
        externalRepositoryId: { in: ["101", "102"] },
        workspaceId: { not: "workspace_1" },
      },
      select: { id: true },
    });
  });

  it("uses database time for concurrent request ordering", async () => {
    const f = fakePrisma();
    await expect(f.inventory.requestStartedAt()).resolves.toEqual(started);
    expect(f.prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it("commits summary, scoped deselection and only successful projects together", async () => {
    const f = fakePrisma();
    f.tx.repositoryConnection.findUnique.mockResolvedValueOnce({
      id: "repo_101",
      workspaceId: "workspace_1",
    });
    await expect(f.inventory.record(input())).resolves.toEqual({
      installationId: "installation_1",
    });
    expect(f.prisma.$transaction).toHaveBeenCalledOnce();
    expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(f.tx.gitLabInstallation.upsert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: "workspace_1",
          sourceBaseUrl: "https://gitlab.com",
          lastInstalledAt: started,
        }),
        update: expect.objectContaining({
          selectedProjects: 2,
          status: "active",
        }),
      }),
    );
    expect(f.tx.repositoryConnection.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        workspaceId: "workspace_1",
        provider: "gitlab",
        gitlabInstallationId: "installation_1",
        externalRepositoryId: { notIn: ["101", "102"] },
      },
      data: expect.objectContaining({ selected: false }),
    });
    expect(f.tx.repositoryConnection.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "repo_101" },
      data: expect.not.objectContaining({ workspaceId: expect.anything() }),
    });
    expect(f.tx.repositoryConnection.create).not.toHaveBeenCalled();
    expect(f.tx.repositoryConnection.findUnique).toHaveBeenCalledOnce();
  });

  it("rejects a different workspace owner without transferring the repository", async () => {
    const f = fakePrisma();
    f.tx.repositoryConnection.findUnique.mockResolvedValueOnce({
      id: "owned_elsewhere",
      workspaceId: "workspace_2",
    });
    await expect(f.inventory.record(input())).rejects.toThrow(
      "gitlab_repository_already_owned",
    );
    expect(f.tx.repositoryConnection.update).not.toHaveBeenCalled();
    expect(f.tx.repositoryConnection.create).not.toHaveBeenCalled();
  });

  it("rejects an older overlapping request before changing the snapshot", async () => {
    const f = fakePrisma();
    f.tx.gitLabInstallation.findUnique.mockResolvedValueOnce({
      lastInstalledAt: new Date(started.getTime() + 1000),
    });
    await expect(f.inventory.record(input())).rejects.toThrow(
      "gitlab_install_superseded",
    );
    expect(f.tx.gitLabInstallation.upsert).not.toHaveBeenCalled();
    expect(f.tx.repositoryConnection.updateMany).not.toHaveBeenCalled();
  });

  it("does not swallow a failing repository write", async () => {
    const f = fakePrisma();
    f.tx.repositoryConnection.create.mockRejectedValueOnce(
      new Error("injected_database_failure"),
    );
    await expect(f.inventory.record(input())).rejects.toThrow(
      "injected_database_failure",
    );
    expect(f.prisma.$transaction).toHaveBeenCalledOnce();
  });
});
