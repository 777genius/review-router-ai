import type {
  GitLabRepositoryContext,
  GitLabRepositoryIdentity,
  GitLabRepositoryPort,
} from "@reviewrouter/features-gitlab-integration";

export class FallbackGitLabRepositoryRegistry implements GitLabRepositoryPort {
  constructor(private readonly registries: readonly GitLabRepositoryPort[]) {
    if (registries.length === 0) {
      throw new Error("gitlab_repository_registry_fallback_empty");
    }
  }

  async findRepositoryByGitLabProjectIdentity(
    identity: GitLabRepositoryIdentity,
  ): Promise<GitLabRepositoryContext | null> {
    for (const registry of this.registries) {
      const repository =
        await registry.findRepositoryByGitLabProjectIdentity(identity);
      // Deselected and inactive DB records are authoritative denials.
      if (repository) return repository;
    }
    return null;
  }
}
