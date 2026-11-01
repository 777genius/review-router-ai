import { describe, expect, it, vi } from "vitest";
import { PrismaGitLabRepositoryRegistry } from "./prisma-gitlab-repository-registry";

const gitlabIdentity = {
  gitlabProjectId: "101",
  sourceBaseUrl: "https://gitlab.com",
} as const;

function repository(selected = true) {
  return {
    id: "repo_1",
    workspaceId: "workspace_1",
    externalRepositoryId: "101",
    sourceBaseUrl: "https://gitlab.com",
    fullName: "acme/platform/api",
    owner: "acme/platform",
    selected,
    gitlabInstallation: { status: "active" },
  };
}

describe("PrismaGitLabRepositoryRegistry", () => {
  it("looks up the exact provider, verified issuer and immutable project ID", async () => {
    const findUnique = vi.fn().mockResolvedValue(repository());
    const registry = new PrismaGitLabRepositoryRegistry({
      repositoryConnection: { findUnique },
    } as never);

    await expect(
      registry.findRepositoryByGitLabProjectIdentity(gitlabIdentity),
    ).resolves.toEqual({
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      gitlabProjectId: "101",
      sourceBaseUrl: "https://gitlab.com",
      fullName: "acme/platform/api",
      owner: "acme/platform",
      selected: true,
      installationStatus: "active",
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalRepositoryId_sourceBaseUrl: {
            provider: "gitlab",
            externalRepositoryId: "101",
            sourceBaseUrl: "https://gitlab.com",
          },
        },
      }),
    );
  });

  it("does not admit the same project ID from a different GitLab issuer", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const registry = new PrismaGitLabRepositoryRegistry({
      repositoryConnection: { findUnique },
    } as never);
    await expect(
      registry.findRepositoryByGitLabProjectIdentity({
        gitlabProjectId: "101",
        sourceBaseUrl: "https://gitlab.example",
      }),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalRepositoryId_sourceBaseUrl: {
            provider: "gitlab",
            externalRepositoryId: "101",
            sourceBaseUrl: "https://gitlab.example",
          },
        },
      }),
    );
  });

  it("returns a deselected database record so static fallback cannot override its denial", async () => {
    const findUnique = vi.fn().mockResolvedValue(repository(false));
    const registry = new PrismaGitLabRepositoryRegistry({
      repositoryConnection: { findUnique },
    } as never);
    await expect(
      registry.findRepositoryByGitLabProjectIdentity(gitlabIdentity),
    ).resolves.toMatchObject({
      selected: false,
      installationStatus: "active",
    });
  });

  it("returns null only when no database record exists", async () => {
    const registry = new PrismaGitLabRepositoryRegistry({
      repositoryConnection: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(
      registry.findRepositoryByGitLabProjectIdentity(gitlabIdentity),
    ).resolves.toBeNull();
  });
});
