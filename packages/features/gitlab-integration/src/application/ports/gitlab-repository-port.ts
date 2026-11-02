import type {
  GitLabMergeRequestIdentity,
  GitLabRepositoryContext,
} from "../../domain/gitlab-ci-identity";

export type GitLabRepositoryIdentity = Readonly<{
  gitlabProjectId: string;
  /** Origin of a verified GitLab OIDC issuer, not a client-supplied host. */
  sourceBaseUrl: string;
}>;

export interface GitLabRepositoryPort {
  /** Includes deselected records so static fallback cannot restore access. */
  findRepositoryByGitLabProjectIdentity(
    identity: GitLabRepositoryIdentity,
  ): Promise<GitLabRepositoryContext | null>;
}

export interface GitLabMergeRequestPort {
  getMergeRequest(input: {
    readonly projectId: string;
    readonly mergeRequestIid: string;
  }): Promise<GitLabMergeRequestIdentity>;
}
