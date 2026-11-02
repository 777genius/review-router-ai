import { describe, expect, it, vi } from "vitest";
import type {
  GitLabRepositoryContext,
  GitLabRepositoryPort,
} from "@reviewrouter/features-gitlab-integration";
import { FallbackGitLabRepositoryRegistry } from "./fallback-gitlab-repository-registry";

const identity = {
  sourceBaseUrl: "https://gitlab.com",
  gitlabProjectId: "123",
};

describe("FallbackGitLabRepositoryRegistry", () => {
  it("uses the primary registry when the repository exists there", async () => {
    const primaryRepository = createRepository("repo_db");
    const primary = createRegistry(primaryRepository);
    const fallback = createRegistry(createRepository("repo_static"));
    const registry = new FallbackGitLabRepositoryRegistry([primary, fallback]);

    await expect(
      registry.findRepositoryByGitLabProjectIdentity(identity),
    ).resolves.toEqual(primaryRepository);
    expect(primary.findRepositoryByGitLabProjectIdentity).toHaveBeenCalledWith(
      identity,
    );
    expect(
      fallback.findRepositoryByGitLabProjectIdentity,
    ).not.toHaveBeenCalled();
  });

  it("falls back to the static registry when the primary registry misses", async () => {
    const fallbackRepository = createRepository("repo_static");
    const primary = createRegistry(null);
    const fallback = createRegistry(fallbackRepository);
    const registry = new FallbackGitLabRepositoryRegistry([primary, fallback]);

    await expect(
      registry.findRepositoryByGitLabProjectIdentity(identity),
    ).resolves.toEqual(fallbackRepository);
    expect(primary.findRepositoryByGitLabProjectIdentity).toHaveBeenCalledWith(
      identity,
    );
    expect(fallback.findRepositoryByGitLabProjectIdentity).toHaveBeenCalledWith(
      identity,
    );
  });

  it("does not fall back when the primary database record is deselected", async () => {
    const deselected = { ...createRepository("repo_db"), selected: false };
    const primary = createRegistry(deselected);
    const fallback = createRegistry(createRepository("repo_static"));
    const registry = new FallbackGitLabRepositoryRegistry([primary, fallback]);

    await expect(
      registry.findRepositoryByGitLabProjectIdentity(identity),
    ).resolves.toEqual(deselected);
    expect(
      fallback.findRepositoryByGitLabProjectIdentity,
    ).not.toHaveBeenCalled();
  });

  it("returns null only after every registry misses", async () => {
    const registry = new FallbackGitLabRepositoryRegistry([
      createRegistry(null),
      createRegistry(null),
    ]);

    await expect(
      registry.findRepositoryByGitLabProjectIdentity(identity),
    ).resolves.toBeNull();
  });
});

function createRegistry(
  repository: GitLabRepositoryContext | null,
): GitLabRepositoryPort {
  return {
    findRepositoryByGitLabProjectIdentity: vi.fn(async () => repository),
  };
}

function createRepository(repositoryId: string): GitLabRepositoryContext {
  return {
    workspaceId: "workspace_1",
    repositoryId,
    gitlabProjectId: "123",
    fullName: "group/project",
    owner: "group",
    selected: true,
    installationStatus: "active",
  };
}
