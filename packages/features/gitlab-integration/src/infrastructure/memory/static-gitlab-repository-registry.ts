import type {
  GitLabRepositoryIdentity,
  GitLabRepositoryPort,
} from "../../application/ports/gitlab-repository-port";
import {
  defaultGitLabIssuer,
  type GitLabRepositoryContext,
} from "../../domain/gitlab-ci-identity";
import { normalizeGitLabSourceBaseUrl } from "../../domain/gitlab-source-url";

function identityKey(identity: GitLabRepositoryIdentity): string {
  return JSON.stringify([identity.sourceBaseUrl, identity.gitlabProjectId]);
}

export class StaticGitLabRepositoryRegistry implements GitLabRepositoryPort {
  private readonly repositoriesByIdentity: ReadonlyMap<
    string,
    GitLabRepositoryContext
  >;

  constructor(repositories: readonly GitLabRepositoryContext[]) {
    const entries = new Map<string, GitLabRepositoryContext>();
    for (const repository of repositories) {
      const sourceBaseUrl = normalizeGitLabSourceBaseUrl(
        repository.sourceBaseUrl ?? defaultGitLabIssuer,
      );
      const key = identityKey({
        sourceBaseUrl,
        gitlabProjectId: repository.gitlabProjectId,
      });
      if (entries.has(key)) {
        throw new Error("gitlab_static_repository_duplicate");
      }
      entries.set(key, repository);
    }
    this.repositoriesByIdentity = entries;
  }

  async findRepositoryByGitLabProjectIdentity(
    identity: GitLabRepositoryIdentity,
  ): Promise<GitLabRepositoryContext | null> {
    return this.repositoriesByIdentity.get(identityKey(identity)) ?? null;
  }
}
