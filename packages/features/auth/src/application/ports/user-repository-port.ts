import type { AuthenticatedPrincipal } from "../../domain/authenticated-principal";
import type { ExternalIdentity } from "../../domain/external-identity";
import type { GitHubExternalIdentity } from "../../domain/github-external-identity";

export interface UserRepositoryPort {
  /**
   * Provider-neutral identity upsert used by GitHub and GitLab sign-in flows.
   * Atomically refreshes the User and identity snapshots, preserving the
   * identity's stable owner. Concurrent first logins converge to that same
   * persisted owner; login and email never establish ownership.
   */
  upsertExternalIdentity(
    identity: ExternalIdentity,
  ): Promise<AuthenticatedPrincipal>;

  upsertGitHubUser(
    identity: GitHubExternalIdentity,
  ): Promise<AuthenticatedPrincipal>;
}
