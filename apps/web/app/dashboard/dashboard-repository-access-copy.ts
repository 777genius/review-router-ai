type RepositoryAccessPresentation = {
  readonly badge: string;
  readonly title: string;
  readonly body: string;
  readonly reconnect: boolean;
  readonly canRefresh: boolean;
  readonly tone: "accent" | "warning";
  readonly actionUrl?: string;
  readonly actionLabel?: string;
};

const repositoryAccessSetupIssue: RepositoryAccessPresentation = {
  badge: "Setup needs attention",
  title: "GitHub repository access is unavailable.",
  body: "ReviewRouter needs a setup fix before it can check your GitHub access. Contact support to restore repository discovery.",
  reconnect: false,
  canRefresh: false,
  tone: "warning",
  actionUrl: "/support",
  actionLabel: "Contact support",
};

export function repositoryAccessPresentation(
  status: string,
  errorCode?: string,
  context: "notice" | "empty" = "notice",
): RepositoryAccessPresentation {
  if (
    status === "token_encryption_misconfigured" ||
    errorCode === "github_oauth_client_misconfigured"
  )
    return repositoryAccessSetupIssue;
  if (status === "token_missing")
    return {
      badge: "GitHub connection needed",
      title: "Reconnect GitHub to show repositories you can manage.",
      body: "Reconnect GitHub so ReviewRouter can check which connected repositories you have permission to manage.",
      reconnect: true,
      canRefresh: false,
      tone: "warning",
    };
  if (
    status === "token_revoked" ||
    status === "token_expired" ||
    status === "token_decryption_failed" ||
    status === "reauthorization_required" ||
    errorCode === "github_user_token_refresh_reauthorization_required"
  )
    return {
      badge: "GitHub reconnection needed",
      title: "Reconnect GitHub to restore repository access.",
      body: "Your GitHub connection can no longer be used to check repository access. Reconnect GitHub to continue.",
      reconnect: true,
      canRefresh: false,
      tone: "warning",
    };
  if (status === "github_error" || status === "token_refresh_failed")
    return {
      badge: "GitHub access",
      title: "GitHub repository access could not be refreshed.",
      body: "Try refreshing access again shortly.",
      reconnect: false,
      canRefresh: true,
      tone: "warning",
    };
  return context === "empty"
    ? {
        badge: "No repositories found",
        title: "No connected repositories found.",
        body: "Connect GitHub repositories, then return to the dashboard to finish setup. GitLab is in development and not available yet.",
        reconnect: false,
        canRefresh: true,
        tone: "accent",
      }
    : {
        badge: "GitHub access",
        title: "Repository access follows your GitHub permissions.",
        body: "Only connected repositories where you have write, maintain, or admin access are shown.",
        reconnect: false,
        canRefresh: true,
        tone: "accent",
      };
}

export function repositoryAccessErrorPresentation(
  error: string,
): RepositoryAccessPresentation | null {
  if (error === "dashboard_auth_misconfigured")
    return repositoryAccessSetupIssue;
  const statuses = [
    "reauthorization_required",
    "token_missing",
    "token_revoked",
    "token_expired",
    "token_refresh_failed",
    "token_decryption_failed",
    "token_encryption_misconfigured",
    "github_error",
  ];
  const status = error.replace(/^repository_access_/u, "");
  return error.startsWith("repository_access_") && statuses.includes(status)
    ? repositoryAccessPresentation(status)
    : null;
}
