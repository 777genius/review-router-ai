/** A completed dashboard authority decision, before configuration writer entry.
 * Keep the established messages for callers that render those error codes.
 * Transport errors and incomplete authority facts must never use this type.
 */
export class DashboardMutationRefusedError extends Error {
  constructor(
    message:
      | "dashboard_mutations_disabled"
      | "dashboard_mutation_requires_sign_in"
      | "repository_mutation_forbidden"
      | "repository_config_mutation_forbidden",
  ) {
    super(message);
    this.name = "DashboardMutationRefusedError";
  }
}

export function repositoryAccessRefreshErrorCode(result: {
  readonly status: string;
  readonly errorCode?: string;
}): string {
  if (result.errorCode === "github_oauth_client_misconfigured")
    return "dashboard_auth_misconfigured";
  if (
    result.errorCode === "github_user_token_refresh_reauthorization_required"
  ) {
    return "repository_access_reauthorization_required";
  }
  return `repository_access_${result.status}`;
}
