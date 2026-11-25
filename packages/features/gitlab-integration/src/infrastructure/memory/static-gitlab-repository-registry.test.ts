import { describe, expect, it } from "vitest";
import type { GitLabRepositoryContext } from "../../domain/gitlab-ci-identity";
import { StaticGitLabRepositoryRegistry } from "./static-gitlab-repository-registry";

const one: GitLabRepositoryContext = {
  workspaceId: "workspace_one",
  repositoryId: "repository_one",
  gitlabProjectId: "101",
  fullName: "team/project",
  owner: "team",
  selected: true,
  installationStatus: "active",
};

describe("StaticGitLabRepositoryRegistry", () => {
  it("distinguishes duplicate project identifiers across trusted issuers", async () => {
    const two: GitLabRepositoryContext = {
      ...one,
      workspaceId: "workspace_two",
      repositoryId: "repository_two",
      sourceBaseUrl: "https://gitlab.example/",
    };
    const registry = new StaticGitLabRepositoryRegistry([one, two]);
    await expect(
      registry.findRepositoryByGitLabProjectIdentity({
        sourceBaseUrl: "https://gitlab.com",
        gitlabProjectId: "101",
      }),
    ).resolves.toEqual(one);
    await expect(
      registry.findRepositoryByGitLabProjectIdentity({
        sourceBaseUrl: "https://gitlab.example",
        gitlabProjectId: "101",
      }),
    ).resolves.toEqual(two);
    await expect(
      registry.findRepositoryByGitLabProjectIdentity({
        sourceBaseUrl: "https://unknown.example",
        gitlabProjectId: "101",
      }),
    ).resolves.toBeNull();
  });

  it("rejects duplicate records for the exact same issuer and project ID", () => {
    expect(
      () =>
        new StaticGitLabRepositoryRegistry([
          one,
          { ...one, sourceBaseUrl: "https://gitlab.com/" },
        ]),
    ).toThrow("gitlab_static_repository_duplicate");
  });
});
