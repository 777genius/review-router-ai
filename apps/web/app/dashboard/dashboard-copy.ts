type DashboardWorkspaceInstallation = {
  readonly accountLogin: string;
  readonly accountType: string;
  readonly githubInstallationId: string;
  readonly repositorySelection: string;
};

export function dashboardNoticeText(
  notice: string,
  repository: string,
): string {
  switch (notice) {
    case "runtime_migration_bootstrap_pr_ready":
      return "First update PR ready. Merge the temporary migration workflow, then click Update setup PR again. Your existing credentials stay in GitHub Secrets. A second PR installs the new review runtime after existing reviews finish.";
    case "runtime_migration_draining":
      return "The old review workflow is paused while admitted reviews finish. Click Update setup PR again after they finish. The migration has not copied credentials yet.";
    case "runtime_migration_running":
      return "The credential migration run is confirmed in GitHub. After it finishes, click Update setup PR to create the final runtime PR. Reviews resume after that PR is merged and verified.";
    case "runtime_migration_recovery_required":
      return "The migration outcome is not confirmed. The old workflow stays paused. Check the existing GitHub migration run and recover the setup before continuing; the dispatch or secret write will not be repeated automatically.";
    case "app_installed":
      return "GitHub App is connected. Search for one repository, then follow its provider-specific setup sequence from this dashboard.";
    case "sync_requested":
      return "Repository metadata refresh was queued. Reload in a few seconds if the repository list does not update immediately.";
    case "sync_already_requested":
      return "Repository metadata refresh was already queued for this installation recently.";
    case "repository_access_refreshed":
      return "GitHub repository access was refreshed for your account.";
    case "setup_pr_ready":
      return repository
        ? `Setup PR is ready for ${repository}.`
        : "Setup PR is ready.";
    case "setup_pr_merged":
      return repository
        ? `Setup PR merge was confirmed for ${repository}.`
        : "Setup PR merge was confirmed.";
    case "provider_setup_confirmed":
      return repository
        ? `Provider setup progress was updated for ${repository}.`
        : "Provider setup progress was updated.";
    case "workflow_already_current":
      return repository
        ? `ReviewRouter workflow is already current for ${repository}.`
        : "ReviewRouter workflow is already current.";
    case "org_ruleset_queued":
      return "Organization-wide required workflow setup was queued. The worker will create or update the central workflow and GitHub ruleset after the permission probe passes.";
    case "review_config_saved":
      return "Review configuration was saved. Future action runs can fetch it through OIDC.";
    case "repository_review_config_saved":
      return repository
        ? `Repository review configuration was saved for ${repository}.`
        : "Repository review configuration was saved.";
    case "repository_review_config_cleared":
      return repository
        ? `${repository} now inherits the workspace review configuration.`
        : "Repository override was cleared.";
    case "memory_saved":
      return "Memory was saved after policy and safety checks.";
    case "memory_suggestion_confirmed":
      return "Suggested memory was confirmed and queued for retrieval indexing.";
    case "memory_suggestion_rejected":
      return "Suggested memory was rejected and will not be used in runtime context.";
    case "memory_disabled":
      return "Memory was disabled and queued for removal from retrieval.";
    case "memory_deleted":
      return "Memory was deleted and queued for removal from retrieval.";
    case "memory_duplicate":
      return "A matching active memory already exists, so nothing was changed.";
    case "memory_already_confirmed":
    case "memory_already_rejected":
    case "memory_already_disabled":
    case "memory_already_deleted":
      return "Memory state was already up to date.";
    case "memory_noop":
      return "No memory change was needed.";
    case "outbox_retry_queued":
      return "Failed background event was queued for retry. Refresh in a few seconds after background processing catches up.";
    case "outbox_retry_not_found":
      return "Failed background event was not found for this workspace.";
    case "outbox_retry_not_dead_letter":
      return "Background event is no longer in dead-letter state and was not manually retried.";
    case "hosted_pool_account_added":
      return "ReviewRouter detected the login. This account is ready for reviews. The session is encrypted on the server and never sent to the browser.";
    case "hosted_pool_account_paused":
      return "Reviews will skip this ChatGPT until you use it again.";
    case "hosted_pool_account_resumed":
      return "This ChatGPT is back in line for reviews.";
    case "hosted_pool_account_updated":
      return "ReviewRouter saved the change. Sessions stay encrypted on the server and are never sent to the browser.";
    case "hosted_pool_account_removed":
      return "This ChatGPT is no longer in the pool. You cannot add this same ChatGPT later.";
    default:
      return "Dashboard action completed.";
  }
}

export function dashboardNoticeTitle(notice: string): string {
  if (notice.startsWith("runtime_migration_")) return "Runtime update";
  switch (notice) {
    case "app_installed":
      return "GitHub App installed";
    case "sync_requested":
    case "sync_already_requested":
      return "Refresh queued";
    case "repository_access_refreshed":
      return "Access refreshed";
    case "setup_pr_ready":
      return "Setup PR ready";
    case "setup_pr_merged":
      return "Setup PR merged";
    case "provider_setup_confirmed":
      return "Provider setup confirmed";
    case "workflow_already_current":
      return "Workflow installed";
    case "org_ruleset_queued":
      return "Org-wide setup queued";
    case "review_config_saved":
    case "repository_review_config_saved":
    case "repository_review_config_cleared":
      return "Model settings saved";
    case "memory_saved":
      return "Memory saved";
    case "memory_suggestion_confirmed":
      return "Suggestion approved";
    case "memory_suggestion_rejected":
      return "Suggestion rejected";
    case "memory_disabled":
      return "Memory disabled";
    case "memory_deleted":
      return "Memory deleted";
    case "memory_duplicate":
      return "Duplicate skipped";
    case "memory_already_confirmed":
    case "memory_already_rejected":
    case "memory_already_disabled":
    case "memory_already_deleted":
    case "memory_noop":
      return "Memory unchanged";
    case "outbox_retry_queued":
    case "outbox_retry_not_found":
    case "outbox_retry_not_dead_letter":
      return "Retry updated";
    case "hosted_pool_account_added":
      return "ChatGPT connected";
    case "hosted_pool_account_paused":
      return "Account paused";
    case "hosted_pool_account_resumed":
      return "Account ready again";
    case "hosted_pool_account_updated":
      return "Account updated";
    case "hosted_pool_account_removed":
      return "Account removed";
    default:
      return "Action complete";
  }
}

export function dashboardNoticeTone(
  notice: string,
): "success" | "warning" | "danger" | "accent" {
  if (notice.startsWith("runtime_migration_")) return "warning";
  switch (notice) {
    case "setup_pr_ready":
    case "setup_pr_merged":
    case "provider_setup_confirmed":
    case "app_installed":
    case "workflow_already_current":
    case "review_config_saved":
    case "repository_review_config_saved":
    case "repository_review_config_cleared":
    case "memory_saved":
    case "memory_suggestion_confirmed":
    case "memory_suggestion_rejected":
    case "memory_disabled":
    case "memory_deleted":
    case "repository_access_refreshed":
    case "hosted_pool_account_added":
    case "hosted_pool_account_paused":
    case "hosted_pool_account_resumed":
    case "hosted_pool_account_updated":
    case "hosted_pool_account_removed":
      return "success";
    case "sync_already_requested":
    case "memory_duplicate":
    case "memory_already_confirmed":
    case "memory_already_rejected":
    case "memory_already_disabled":
    case "memory_already_deleted":
    case "memory_noop":
      return "accent";
    case "outbox_retry_not_found":
    case "outbox_retry_not_dead_letter":
      return "warning";
    default:
      return "accent";
  }
}

export type CodexRotatingProviderState =
  | "setup_pending"
  | "active"
  | "permission_required"
  | "workflow_update_required"
  | "quota_limited"
  | "needs_reconnect"
  | "stale_queued_secret"
  | "skipped_retryable"
  | "policy_blocked"
  | "unknown_auth_state";

export function codexRotatingProviderStateCopy(
  state: CodexRotatingProviderState,
): {
  readonly title: string;
  readonly body: string;
  readonly tone: "success" | "warning" | "danger" | "accent";
} {
  switch (state) {
    case "setup_pending":
      return {
        title: "Codex setup pending",
        body: "Run the repository-scoped rotating Codex setup command from a trusted machine, then rerun the advisory PR workflow.",
        tone: "warning",
      };
    case "active":
      return {
        title: "Codex OAuth active",
        body: "Rotating Codex OAuth is configured for this repository. The beta workflow remains advisory-only.",
        tone: "success",
      };
    case "permission_required":
      return {
        title: "GitHub App permission required",
        body: "Approve the ReviewRouter GitHub App permission update for repository Secrets, Contents, Pull requests, and Issues access, then rerun the workflow.",
        tone: "danger",
      };
    case "workflow_update_required":
      return {
        title: "Workflow update required",
        body: "Update the ReviewRouter workflow to the pinned rotating Codex OAuth beta workflow, then rerun the PR workflow.",
        tone: "warning",
      };
    case "quota_limited":
      return {
        title: "Codex quota limited",
        body: "Codex authenticated successfully, but the account hit quota, billing, or rate limits after writeback. Retry after the account is usable again.",
        tone: "warning",
      };
    case "needs_reconnect":
      return {
        title: "Codex reconnect required",
        body: "The refreshed Codex session is no longer valid. Rerun the rotating setup command with a fresh login. If the installer refuses old dedicated auth, rerun it with --force-reseed.",
        tone: "danger",
      };
    case "stale_queued_secret":
      return {
        title: "Stale Codex secret skipped",
        body: "A newer Codex auth generation is already stored. Rerun the latest workflow instead of refreshing from this queued run.",
        tone: "warning",
      };
    case "skipped_retryable":
      return {
        title: "Codex review skipped",
        body: "The run stopped before refreshing Codex auth. Retry the advisory workflow after GitHub or ReviewRouter recovers.",
        tone: "accent",
      };
    case "policy_blocked":
      return {
        title: "Codex beta policy blocked",
        body: "Rotating Codex OAuth beta only runs on private same-repository PRs from GitHub-hosted runners with the generated advisory workflow.",
        tone: "danger",
      };
    case "unknown_auth_state":
      return {
        title: "Codex auth state unknown",
        body: "Codex may have refreshed before GitHub secret writeback was confirmed. Rerun the rotating setup command before relying on this repository's Codex OAuth secret.",
        tone: "danger",
      };
  }
}

export function isProviderSecretCheckError(error: string): boolean {
  return (
    error === "repository_not_visible_to_github_app" ||
    error === "provider_secret_not_found" ||
    error === "provider_secret_not_available_to_repository" ||
    error === "provider_secret_check_permission_required"
  );
}

export function isMemoryError(error: string): boolean {
  return [
    "contains_code_block",
    "contains_diff_hunk",
    "contains_large_stacktrace",
    "contains_prompt_injection",
    "contains_secret_like_text",
    "memory_active_item_quota_exceeded",
    "memory_dashboard_in_development",
    "memory_disabled",
    "memory_not_found",
    "memory_pending_suggestion_quota_exceeded",
    "memory_safety_blocked",
    "not_repository_maintainer",
    "not_user_owner",
    "not_workspace_admin",
    "permission_service_unavailable",
    "repository_unavailable",
    "too_long",
    "unsafe_for_user_prefs",
  ].includes(error);
}

export function isSetupRecoveryIssue(
  value: string | null | undefined,
): boolean {
  return (
    value === "setup_pr_closed" ||
    value === "setup_pr_branch_deleted" ||
    value === "setup_pr_wrong_base_branch" ||
    value === "setup_pr_workflow_mismatch"
  );
}

export function workspaceInstallSummary(workspace: {
  readonly installations: readonly DashboardWorkspaceInstallation[];
  readonly gitLabInstallations?: readonly {
    readonly namespacePath: string;
    readonly selectedProjects: number;
  }[];
}): string {
  const installation = workspace.installations[0];
  if (!installation) {
    const gitLabInstallation = workspace.gitLabInstallations?.[0];
    if (gitLabInstallation) {
      const projectLabel =
        gitLabInstallation.selectedProjects === 1 ? "project" : "projects";
      return `GitLab connection - ${gitLabInstallation.selectedProjects} selected ${projectLabel}`;
    }
    return "Signed-in source workspace - connect repositories to continue.";
  }

  const accountType = formatAccountTypeLabel(installation.accountType);
  const repositoryScope =
    installation.repositorySelection === "all"
      ? "all repositories available"
      : "selected repositories only";

  return `${accountType} GitHub App install - ${repositoryScope}`;
}

export function formatAccountTypeLabel(accountType: string): string {
  return accountType === "Organization" ? "Organization" : "Personal";
}

export function orgRulesetStatusTone(
  status: string | undefined,
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "configured":
      return "success";
    case "requested":
    case "processing":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function orgRulesetErrorText(error: string): string {
  switch (error) {
    case "codex_runtime_migration_target_unavailable":
      return "A compatible credential-preserving runtime update is not published for this connection yet. The existing pin remains installed.";
    case "codex_runtime_migration_source_mismatch":
    case "codex_runtime_migration_source_changed":
    case "codex_runtime_migration_repository_changed":
    case "codex_runtime_migration_bootstrap_source_mismatch":
    case "codex_runtime_migration_ingress_changed":
      return "The repository, workflow, or current credentials changed during the runtime update. Review the existing migration run and setup state before continuing.";
    case "codex_runtime_migration_runs_not_drained":
      return "Admitted reviews are still running. Wait for them to finish, then continue the runtime update.";
    case "codex_runtime_migration_inventory_incomplete":
    case "codex_runtime_migration_inventory_changed":
    case "codex_runtime_migration_ingress_state_unknown":
    case "codex_runtime_migration_ingress_not_disabled":
    case "codex_runtime_migration_disable_unconfirmed":
    case "codex_runtime_migration_enable_unconfirmed":
    case "codex_runtime_migration_dispatch_ambiguous":
    case "codex_runtime_migration_recovery_required":
    case "codex_runtime_migration_recovery_conflict":
    case "codex_runtime_migration_activation_invalid":
      return "The runtime update needs recovery because its exact GitHub or setup state could not be confirmed. Inspect the existing migration run before continuing. The old workflow is not re-enabled automatically.";
    case "codex_runtime_migration_bootstrap_cleanup_required":
      return "Merge the final runtime setup PR, which removes the temporary migration workflow, then verify setup to resume reviews.";
    case "codex_runtime_migration_workflow_missing_or_ambiguous":
    case "codex_runtime_migration_bootstrap_not_ready":
      return "Merge the first runtime update PR into the default branch and wait for GitHub to index its migration workflow, then click Update setup PR again.";
    case "org_admin_permission_required":
      return "Organization Administration: write is required for org-wide rulesets.";
    case "org_rulesets_not_supported":
      return "GitHub organization rulesets are unavailable on this organization plan. Private organization repositories require GitHub Team or Enterprise; use per-repository setup PR fallback until the organization plan is upgraded.";
    case "org_ruleset_permission_update_pending":
      return "GitHub rejected the ruleset probe. The App permission update may still need approval.";
    case "org_ruleset_all_repositories_requires_all_access":
      return "All-repositories ruleset requires the GitHub App installation to be configured for all repositories.";
    case "github_org_ruleset_validation_failed":
      return "GitHub rejected the ruleset payload. If you chose Evaluate, switch to Active unless the organization is on GitHub Enterprise.";
    default:
      return error.replaceAll("_", " ");
  }
}

export function dashboardErrorText(error: string): string {
  if (isCodexRotatingProviderState(error)) {
    return codexRotatingProviderStateCopy(error).body;
  }

  switch (error) {
    case "dashboard_mutations_disabled":
      return "Dashboard mutations are disabled on this environment.";
    case "dashboard_auth_misconfigured":
      return "GitHub OAuth is not configured. Set AUTH_SECRET, GITHUB_APP_CLIENT_ID, and GITHUB_APP_CLIENT_SECRET.";
    case "dashboard_mutation_requires_sign_in":
      return "Sign in with GitHub before changing repository setup.";
    case "repository_access_token_missing":
      return "Reconnect GitHub to discover repositories you can manage.";
    case "repository_access_token_revoked":
    case "repository_access_token_expired":
    case "repository_access_token_refresh_failed":
    case "repository_access_token_decryption_failed":
      return "GitHub authorization expired. Reconnect GitHub, then refresh repository access.";
    case "repository_access_token_encryption_misconfigured":
      return "Server setup is incomplete. Set REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY before maintainer repository discovery can run.";
    case "repository_access_github_error":
      return "GitHub repository access could not be refreshed. Try again shortly.";
    case "workspace_mutation_forbidden":
      return "Your GitHub user is not an owner/admin for this workspace.";
    case "repository_mutation_forbidden":
      return "Your GitHub user needs write, maintain, or admin access on this repository to change repository-level ReviewRouter settings.";
    case "repository_config_mutation_forbidden":
      return "Your GitHub user needs maintain or admin access on this repository to change ReviewRouter runtime settings directly.";
    case "operation_already_running":
      return "Another setup or sync operation is already running. Try again shortly.";
    case "rate_limited":
      return "Too many dashboard requests for this resource. Wait a bit before retrying.";
    case "review_policy_resave_required":
      return "Saved review policy uses a retired or unreadable format and reviews are stopped. Review and save the policy explicitly, or remove the repository override to inherit workspace settings.";
    case "review_provider_selection_required":
      return "No review provider applies here yet. Choose a workspace default or a provider for this repository before enabling reviews.";
    case "review_provider_profile_unavailable":
      return "The selected provider was archived or removed. Choose another provider and save again.";
    case "rotating_profile_repository_only":
      return "A rotating Codex provider belongs to its own repository and cannot be used anywhere else.";
    case "review_configuration_gateway_profile_mismatch":
      return "The account behind this provider now uses another profile. Choose the account again to create a new provider.";
    case "review_workspace_policy_retired":
      return "The workspace settings use a retired format. An owner or admin replaces them by choosing a default provider; then choose this repository's provider.";
    case "hosted_pool_session_source_required":
      return "A hosted Codex pool is turned on for each repository with its session source setting, so it cannot be chosen here or made the default.";
    case "provider_profile_invalid":
      return "The provider details are invalid. Check the model and label, then try again.";
    case "provider_profile_not_found":
      return "This provider no longer exists in the workspace. Refresh the dashboard.";
    case "provider_profile_credential_unavailable":
      return "The credential of this provider is not available. Connect the account or upload the managed key first.";
    case "provider_profile_workspace_unavailable":
      return "This workspace is being deleted, so its providers cannot change.";
    case "provider_profile_duplicate":
      return "A provider with the same credential and model already exists in this workspace.";
    case "provider_profile_in_use":
      return "This provider is still selected by the workspace default or a repository. Choose another provider there first.";
    case "provider_profile_model_incompatible":
      return "The new model does not support the reasoning or fast settings some repositories use with this provider.";
    case "review_provider_settings_incompatible":
      return "The reasoning or fast settings do not fit this provider's model. Choose the provider again and check its settings.";
    case "review_execution_limits_incompatible":
      return "The saved parallel review or agreement limits name more providers than are selected. Choose the provider again in its provider dialog: that fits the limits to it.";
    case "provider_management_forbidden":
      return "Your role cannot manage this provider. Ask a workspace owner or admin.";
    case "workflow_delete_untrusted":
      return "A ReviewRouter workflow belongs to another active mode (GitHub Secrets/Hosted Pool) or was edited, so it is not removed automatically. Disconnect that mode, or remove the exact file named in the Diagnostics audit event, then retry.";
    case "invalid_form":
      return "The submitted form is invalid. Refresh the dashboard and try again.";
    case "dashboard_action_failed":
      return "The dashboard could not complete this action. Refresh and try again.";
    case "dashboard_action_stale":
      return "The dashboard was updated while this page was open. Refresh the page, then try again.";
    case "server_misconfigured":
      return "Server setup is incomplete. Check GitHub App credentials and the public ReviewRouter API URL.";
    case "github_operation_forbidden":
      return "GitHub refused this dashboard action. Check GitHub App permissions and branch protection, then retry.";
    case "github_operation_not_found":
      return "GitHub could not find the repository, branch, or pull request needed for this action. Sync repositories and confirm App access, then retry.";
    case "github_operation_conflict":
      return "GitHub reported a write conflict. Retry once after the current repository operation settles.";
    case "github_validation_failed":
      return "GitHub rejected the request. Check whether the pull request can be reopened or whether branch protection blocks the update.";
    case "github_service_unavailable":
      return "GitHub is temporarily unavailable for this action. Retry after GitHub recovers.";
    case "hosted_account_subject_already_enrolled":
      return "This ChatGPT is already on the list, or it was removed and cannot be added again.";
    case "account_gateway_workflow_options_not_supported":
      return "Gateway setup requires the reusable workflow style and review discussions turned off. Update these options and try again.";
    case "gateway_review_reasoning_effort_unsupported":
      return "The selected Gateway model does not support this reasoning effort. Choose a supported reasoning effort in review settings and save again.";
    case "agent_profile_requires_agentic_context":
      return "OpenCodeReview needs native repository context. Enable Agentic context or choose a compatible ReviewRouter profile before saving.";
    case "provider_api_direct_requires_single_provider":
      return "Use one supported provider and model, then save the review settings.";
    case "provider_api_fast_mode_unsupported":
      return "Turn off Fast mode for MiMo and save the review settings.";
    case "provider_api_reasoning_effort_unsupported":
      return "Choose Low, Medium, or High review depth for MiMo, then save.";
    case "openrouter_direct_requires_single_provider":
      return "Direct OpenRouter reviews currently support one provider and one model. Select a single OpenRouter provider without multi-provider agreement before saving or installing the workflow. Your saved policy has not been replaced.";
    case "openrouter_direct_workflow_options_not_supported":
      return "Direct provider reviews require the reusable App-first workflow without discussion or conflict fallback. Use the review engine approved for your installed runtime.";
    case "claude_subscription_runtime_not_ready":
      return "The Claude review runtime could not be verified. Try creating the setup PR again. If this continues, ask your workspace administrator to check the configured release.";
    case "claude_subscription_workflow_not_qualified":
      return "The saved Claude model or review settings changed during setup, or this runtime does not support them yet. Refresh the dashboard and check the saved connection before creating the setup PR again.";
    case "claude_subscription_workflow_options_not_supported":
      return "Claude reviews require the reusable App-first workflow without discussion or conflict fallback. Choose those workflow settings before creating the setup PR.";
    case "gateway_review_v2_inventory_retry":
      return "GitHub is still calculating pull request mergeability, or branches changed during the workflow check. Wait a minute, then click “I merged it” again to check the setup.";
    case "gateway_review_v2_workflow_incompatible":
      return "Gateway found incompatible ReviewRouter workflows. Check the base branches of open pull requests for legacy .github/workflows/reviewrouter.yml or reviewrouter-codex.yml; remove only obsolete ReviewRouter files from those branches, and close obsolete setup PRs that add them. Then check the merged setup again.";
    case "gateway_review_v2_provisioning_failed":
      return "Gateway setup verification failed. Check audit events or ask your workspace administrator for the safe server error code before trying again.";
    case "gateway_review_v2_release_untrusted":
      return "The Gateway runtime release is not approved. Ask your workspace administrator to check the configured release and its registration, then check the merged setup again.";
    case "gateway_review_v2_dispatch_unavailable":
      return "The GitHub App cannot dispatch reviews for this repository. Check its repository access and Actions write permission, then check the merged setup again.";
    case "gateway_review_v2_proof_blocked":
      return "Gateway authorization prerequisites are incomplete. Ask your workspace administrator to check the repository enrollment and safe server error code.";
    case "gateway_review_v2_safety_blocked":
      return "Workspace safety policy or an emergency stop blocks Gateway reviews. Ask your workspace administrator to review that restriction before checking setup again.";
    case "gateway_review_v2_runtime_not_ready":
      return "The Gateway review runtime is not ready on the server. Ask your workspace administrator to check the worker and runtime registration, then check the merged setup again.";
    case "gateway_review_v2_release_registry_missing":
      return "The Gateway release registry is not configured on the server. Ask your workspace administrator to register the review runtime release, then check the merged setup again.";
    case "gateway_review_v2_policy_conflict":
      return "The repository policy conflicts with the Gateway enrollment state. Ask your workspace administrator to review the saved policy and retry.";
    case "gateway_review_v2_authority_conflict":
      return "Another Gateway enrollment update is in progress for this repository. Wait a minute, then check the merged setup again.";
    case "gateway_review_v2_authority_invalid":
      return "The Gateway enrollment record is out of date. Refresh the dashboard and check the merged setup again.";
    case "gateway_repository_identity_missing":
      return "The repository identity is not registered with the Gateway yet. Sync the installation, then check the merged setup again.";
    case "gateway_repository_binding_conflict":
      return "This repository is already bound to a different Gateway enrollment. Ask your workspace administrator to reconcile the binding, then retry.";
    case "mutation_authority_unavailable":
      return "The service that applies this change is temporarily unavailable. Wait a minute, then retry.";
    case "github_operation_failed":
      return "GitHub operation failed. Check audit events or server logs for the safe error code.";
    case "repository_not_selected":
      return "This repository is no longer selected for the GitHub App installation.";
    case "repository_archived":
      return "Archived repositories cannot be provisioned.";
    case "installation_not_active":
      return "The GitHub App installation is not active.";
    case "setup_pr_not_merged":
      return "GitHub does not show the workflow on the setup PR target branch yet. If you just merged the setup PR, wait a few seconds; the dashboard will advance automatically when GitHub metadata catches up.";
    case "setup_pr_closed":
      return "The saved setup PR was closed before it was merged. Recreate the setup PR, then merge the new one.";
    case "setup_pr_branch_deleted":
      return "The saved setup PR branch was deleted, so GitHub cannot merge that PR anymore. Recreate the setup PR to continue.";
    case "setup_pr_wrong_base_branch":
      return "The saved setup PR was merged outside the allowed setup branches. Recreate the setup PR, then merge it into the repository default branch.";
    case "setup_pr_workflow_mismatch":
      return "The merged setup PR does not contain the expected ReviewRouter workflow. Recreate the setup PR and merge it without edits, then check again.";
    case "repository_not_visible_to_github_app":
      return "The GitHub App installation cannot read this repository. Update App repository access or sync repositories, then try again.";
    case "provider_secret_not_found":
      return "GitHub does not show the required Actions secret yet. Run the command, then try again.";
    case "provider_secret_not_available_to_repository":
      return "The organization Actions secret exists, but it is not available to this repository. Add this repository to the selected-repository secret access, then try again.";
    case "provider_secret_check_permission_required":
      return "ReviewRouter needs GitHub App Secrets: write for repository secrets, or Organization secrets: read for organization secrets, to verify Actions secret metadata and support encrypted Codex OAuth writeback. Approve the App permission update, then try again.";
    case "organization_secret_scope_forbidden":
      return "Organization secret setup requires workspace owner/admin access. Use a repository secret for repo-scoped setup.";
    case "entitlement_denied":
      return "This workspace plan does not allow that action. Check the plan status or feature flags.";
    case "workflow_provisioning_disabled":
      return "Workflow provisioning is disabled. Set REVIEW_ROUTER_ENABLE_WORKFLOW_PROVISIONING=1 in a trusted local or beta environment.";
    case "codex_rotating_not_enabled":
      return "Rotating Codex OAuth is not enabled for this ReviewRouter deployment.";
    case "codex_rotating_repository_scope_required":
      return "Codex rotating OAuth must be configured per repository, not as a workspace default.";
    case "codex_rotating_single_provider_required":
      return "Codex rotating OAuth supports exactly one Codex provider in this repository.";
    case "codex_rotating_workflow_namespace_not_ready":
      return "Run the rotating Codex setup command first and wait for its definite GitHub write confirmation. Then create the setup PR for that exact versioned namespace.";
    case "duplicate_review_provider":
      return "Duplicate provider/model rows are not supported yet. Pick a different model for duplicate providers.";
    case "codex_rotating_provider_instance_required":
      return "Codex rotating setup is incomplete. Reconnect Codex with the rotating setup command, then create the setup PR again.";
    case "codex_legacy_auth_requires_reconnect":
      return "Legacy Codex OAuth is disabled. Reconnect Codex with the rotating setup command, then create the setup PR again.";
    case "codex_api_key_setup_disabled":
      return "Codex API-key setup is disabled. Use Codex OAuth rotating instead.";
    case "codex_provider_requires_rotating_workflow":
      return "Codex requires the rotating workflow. Reconnect Codex with the rotating setup command, then recreate the setup PR.";
    case "org_ruleset_requires_organization_installation":
      return "Organization-wide required workflow is available only for GitHub organization installations. Use per-repository setup PR for personal repositories.";
    case "org_ruleset_no_selected_repositories":
      return "This organization installation has no selected, active repositories to target.";
    case "org_ruleset_all_repositories_requires_all_access":
      return "All-repositories org ruleset requires installing the GitHub App for all repositories first. Use selected repositories or per-repository setup PR fallback.";
    case "org_ruleset_source_repository_invalid":
      return "The configured source repository must be a full GitHub name like org/reviewrouter-workflows.";
    case "org_ruleset_source_repository_wrong_owner":
      return "The source repository must belong to the same GitHub organization as the App installation.";
    case "org_ruleset_source_repository_not_installed":
      return "The source repository reviewrouter-workflows is not visible to the GitHub App. Create it, add it to the App installation, then sync repositories and retry.";
    case "org_ruleset_source_repository_archived":
      return "The source repository reviewrouter-workflows is archived. Unarchive it or create a fresh source repository before enabling org-wide mode.";
    case "org_ruleset_source_repository_not_writable":
      return "ReviewRouter could not write the central workflow to reviewrouter-workflows. Check App repository access, Contents: write, Workflows: write, and branch protection.";
    case "org_ruleset_source_repository_branch_blocked":
      return "GitHub blocked the direct workflow commit to reviewrouter-workflows. Check branch protection or exclude the source repository from active rulesets.";
    case "org_ruleset_source_repository_actions_access_required":
      return "GitHub could not use the source workflow from other private repositories. In reviewrouter-workflows, set Settings - Actions - General - Access to organization repositories.";
    case "org_admin_permission_required":
      return "GitHub did not allow organization ruleset access. Approve the optional Organization Administration: write permission if it is still pending; if it is already approved, the organization plan may not support rulesets. Use per-repository setup PR fallback.";
    case "org_rulesets_not_supported":
      return "GitHub accepted the App permissions, but organization rulesets are unavailable on this organization plan. Private organization repositories require GitHub Team or Enterprise; use per-repository setup PR fallback until the organization plan is upgraded.";
    case "org_ruleset_permission_update_pending":
      return "GitHub rejected the ruleset permission probe. An organization owner may still need to approve the App permission update.";
    case "github_org_ruleset_validation_failed":
      return "GitHub rejected the ruleset payload. Evaluate mode requires GitHub Enterprise; switch to Active or use per-repository setup PR fallback.";
    case "not_repository_maintainer":
      return "Only repository maintainers or workspace admins can confirm repository memory.";
    case "not_workspace_admin":
      return "Only workspace admins can change workspace memory.";
    case "not_user_owner":
      return "User preference memory can only be changed by that user.";
    case "repository_unavailable":
      return "This repository is not available for memory changes. It may be archived, unselected, or outside the workspace.";
    case "memory_active_item_quota_exceeded":
      return "Workspace memory quota is full. Disable or delete older memory before saving or confirming new memory.";
    case "memory_dashboard_in_development":
      return "The memory dashboard is in development. No memory was changed.";
    case "memory_disabled":
      return "Balanced Memory is disabled for this workspace or environment. Existing memory can still be reviewed and removed by authorized admins.";
    case "memory_pending_suggestion_quota_exceeded":
      return "Workspace pending memory suggestion quota is full. Confirm, reject, or let expired suggestions clear before saving more suggestions.";
    case "memory_not_found":
      return "Memory was not found in this workspace.";
    case "contains_secret_like_text":
      return "Memory was blocked because it looks like it contains a secret.";
    case "contains_code_block":
    case "contains_diff_hunk":
      return "Memory was blocked because code or diffs must not be stored.";
    case "contains_large_stacktrace":
      return "Memory was blocked because stack traces must not be stored as memory.";
    case "contains_prompt_injection":
      return "Memory was blocked because it looks like prompt-injection text.";
    case "too_long":
      return "Memory is too long. Save a short distilled preference or rule instead.";
    case "unsafe_for_user_prefs":
      return "User preference memory can only store safe response preferences, not repository-specific facts.";
    case "permission_service_unavailable":
    case "memory_safety_blocked":
      return "Memory policy blocked this change. Refresh and try again with a safer distilled memory.";
    default:
      return unmappedDashboardErrorText(error);
  }
}

/**
 * The single text for "no dedicated guidance exists". Compared against
 * `dashboardErrorText` to decide whether a code may reach the UI, so the switch
 * stays the only source of truth about which codes are explained.
 */
export function unmappedDashboardErrorText(code: string): string {
  return code
    ? `GitHub operation failed (code: ${code}). Ask your workspace administrator to look up this code in Diagnostics audit events.`
    : "GitHub operation failed. Check audit events or server logs for the safe error code.";
}

export function hasDedicatedDashboardErrorCopy(code: string): boolean {
  return dashboardErrorText(code) !== unmappedDashboardErrorText(code);
}

function isCodexRotatingProviderState(
  value: string,
): value is CodexRotatingProviderState {
  return [
    "setup_pending",
    "active",
    "permission_required",
    "workflow_update_required",
    "quota_limited",
    "needs_reconnect",
    "stale_queued_secret",
    "skipped_retryable",
    "policy_blocked",
    "unknown_auth_state",
  ].includes(value);
}

export function readCsvEnv(name: string): readonly string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildInstallationSettingsUrl(
  installation: Pick<
    DashboardWorkspaceInstallation,
    "accountLogin" | "accountType" | "githubInstallationId"
  >,
): string | null {
  if (!/^\d+$/.test(installation.githubInstallationId)) return null;
  if (installation.accountType === "Organization") {
    if (!/^[A-Za-z0-9-]+$/.test(installation.accountLogin)) return null;
    return `https://github.com/organizations/${installation.accountLogin}/settings/installations/${installation.githubInstallationId}`;
  }
  return `https://github.com/settings/installations/${installation.githubInstallationId}`;
}
