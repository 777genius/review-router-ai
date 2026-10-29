import {
  resolveReviewConfiguration,
  providerApiConfigurationMode,
  type ReviewConfigurationRepositoryPort,
} from "@reviewrouter/features-review-config";
import {
  recordAuditEvent,
  type AuditLogRepositoryPort,
} from "@reviewrouter/features-audit-log";
import {
  renderCanonicalCodexRotatingInteractionWorkflowV3,
  renderReviewRouterWorkflowFiles,
  renderAccountGatewayWorkflow,
  renderProviderApiWorkflow,
  renderClaudeSubscriptionWorkflow,
  defaultWorkflowPath,
  defaultCodexRotatingWorkflowPath,
  defaultInteractionWorkflowPath,
  getObsoleteGatewayCallerDeletionMarkerGroups,
  getLegacyReviewRouterWorkflowDeletionMarkerGroups,
  getLegacyReviewRouterInteractionWorkflowDeletionMarkerGroups,
  reviewRouterWorkflowContract,
} from "../../domain/workflow-template";
import {
  createProvisionWorkflowPlan,
  type ProvisionWorkflowInput,
} from "../../domain/workflow-provisioning";
import {
  renderedWorkflowRequirement,
  inspectRequiredWorkflowTransport,
  isClaudeSubscriptionConfiguration,
  workflowRequirement,
  type WorkflowTransport,
} from "../../domain/workflow-transport";
import type { WorkflowProvisioningRepositoryPort } from "../ports/workflow-provisioning-repository-port";
import type { WorkflowSetupGatewayPort } from "../ports/workflow-setup-gateway-port";

export type ProvisionReviewRouterWorkflowDependencies = {
  readonly secretsRuntimeActionRef?: string;
  /** Exact registered producer qualified for the saved native Claude route. */
  readonly claudeSubscriptionActionRef?: string;
  readonly setupGateway: WorkflowSetupGatewayPort;
  readonly provisioning: WorkflowProvisioningRepositoryPort;
  readonly auditLog?: AuditLogRepositoryPort;
  readonly enabled?: boolean;
  readonly actor?: string;
  readonly auditMetadata?: Readonly<Record<string, unknown>>;
  readonly configurations?: ReviewConfigurationRepositoryPort;
  readonly trustedGithubRepositoryId?: string;
};

export async function provisionReviewRouterWorkflow(
  input: ProvisionWorkflowInput,
  dependencies: ProvisionReviewRouterWorkflowDependencies,
) {
  const saved = dependencies.configurations
    ? await resolveReviewConfiguration(
        {
          scope: "repository",
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
        },
        { configurations: dependencies.configurations },
      )
    : undefined;
  const transport = saved
    ? inspectRequiredWorkflowTransport(saved.config)
    : null;
  if (transport !== null && typeof transport !== "string")
    throw new Error(transport.reason);
  const gatewaySelected = transport === "gateway";
  const providerApiSelected = transport === "provider_api";
  const claudeSubscriptionSelected = Boolean(
    saved &&
    isClaudeSubscriptionConfiguration(saved.config) &&
    saved.config.providers[0]!.agenticContext !== false &&
    dependencies.claudeSubscriptionActionRef,
  );
  if (dependencies.claudeSubscriptionActionRef && !claudeSubscriptionSelected)
    throw new Error("claude_subscription_workflow_not_qualified");
  const selectedProviderApiMode =
    providerApiSelected && saved
      ? providerApiConfigurationMode(saved.config)
      : undefined;
  if (
    !gatewaySelected &&
    input.mcpSecrets &&
    Object.keys(input.mcpSecrets).length
  )
    throw new Error("mcp_secrets_gateway_workflow_required");
  if (input.providerApiAuthMode && !providerApiSelected)
    throw new Error("openrouter_direct_requires_single_provider");
  if (input.subscriptionAuthMode && !claudeSubscriptionSelected)
    throw new Error("claude_subscription_workflow_not_qualified");
  if (
    claudeSubscriptionSelected &&
    (input.providerApiAuthMode !== undefined ||
      input.codexSessionMode !== undefined ||
      input.runtimeConfigMode !== "oidc" ||
      input.staticRuntimeEnv !== undefined ||
      (input.workflowStyle !== undefined &&
        input.workflowStyle !== "reusable") ||
      input.conflictReviewFallbackEnabled === true ||
      input.forkAgenticSandboxEnabled === true ||
      (input.discussionMode !== undefined && input.discussionMode !== "off") ||
      input.codexRotatingProviderInstanceId !== undefined ||
      input.codexRotatingWorkflowSecretNamespace !== undefined ||
      input.codexRotatingReviewActionV2Mode !== undefined ||
      input.codexRotatingWorkflowSchemaVersion !== undefined ||
      (input.workflowPath !== undefined &&
        input.workflowPath !== reviewRouterWorkflowContract.callerPath))
  )
    throw new Error("claude_subscription_workflow_options_not_supported");
  if (
    providerApiSelected &&
    (input.providerApiAuthMode !== selectedProviderApiMode ||
      input.codexSessionMode !== undefined ||
      input.runtimeConfigMode !== "oidc" ||
      input.staticRuntimeEnv !== undefined ||
      (input.workflowStyle !== undefined &&
        input.workflowStyle !== "reusable") ||
      input.conflictReviewFallbackEnabled === true ||
      input.forkAgenticSandboxEnabled === true ||
      (input.discussionMode !== undefined && input.discussionMode !== "off") ||
      input.codexRotatingProviderInstanceId !== undefined ||
      input.codexRotatingWorkflowSecretNamespace !== undefined ||
      input.codexRotatingReviewActionV2Mode !== undefined ||
      input.codexRotatingWorkflowSchemaVersion !== undefined ||
      (input.workflowPath !== undefined &&
        input.workflowPath !== reviewRouterWorkflowContract.callerPath))
  )
    throw new Error("openrouter_direct_workflow_options_not_supported");
  const gatewayHint =
    input.codexSessionMode !== undefined ||
    input.staticRuntimeEnv?.REVIEW_AUTH_MODE === "codex-account-gateway" ||
    input.staticRuntimeEnv?.REVIEW_ROUTER_GATEWAY_BINDING_ID !== undefined ||
    input.staticRuntimeEnv?.REVIEW_ROUTER_GATEWAY_PROFILE_REF !== undefined;
  if (gatewayHint && !gatewaySelected) {
    throw new Error("account_gateway_saved_config_required");
  }
  if (
    (gatewaySelected || providerApiSelected || claudeSubscriptionSelected) &&
    (!dependencies.trustedGithubRepositoryId ||
      input.githubRepositoryId !== dependencies.trustedGithubRepositoryId)
  ) {
    throw new Error("account_gateway_repository_identity_required");
  }
  if (
    gatewaySelected &&
    (input.providerApiAuthMode !== undefined ||
      input.codexSessionMode !== "account-gateway" ||
      input.runtimeConfigMode !== "oidc" ||
      input.staticRuntimeEnv !== undefined ||
      (input.workflowStyle !== undefined &&
        input.workflowStyle !== "reusable") ||
      input.conflictReviewFallbackEnabled === true ||
      input.forkAgenticSandboxEnabled === true ||
      (input.discussionMode !== undefined && input.discussionMode !== "off") ||
      input.codexRotatingProviderInstanceId !== undefined ||
      input.codexRotatingWorkflowSecretNamespace !== undefined ||
      input.codexRotatingReviewActionV2Mode !== undefined ||
      input.codexRotatingWorkflowSchemaVersion !== undefined ||
      (input.workflowPath !== undefined &&
        input.workflowPath !== reviewRouterWorkflowContract.callerPath))
  ) {
    throw new Error("account_gateway_workflow_options_not_supported");
  }
  const managedFile = gatewaySelected
    ? renderAccountGatewayWorkflow({
        actionRef: input.actionRef,
        apiUrl: input.apiUrl,
        githubRepositoryId: dependencies.trustedGithubRepositoryId!,
        ...(input.mcpSecrets !== undefined
          ? { mcpSecrets: input.mcpSecrets }
          : {}),
      })
    : providerApiSelected
      ? renderProviderApiWorkflow({
          ...(selectedProviderApiMode
            ? { providerApiAuthMode: selectedProviderApiMode }
            : {}),
          actionRef: input.actionRef,
          apiUrl: input.apiUrl,
        })
      : claudeSubscriptionSelected
        ? renderClaudeSubscriptionWorkflow({
            actionRef: dependencies.claudeSubscriptionActionRef!,
            apiUrl: input.apiUrl,
          })
        : undefined;
  const plan = createProvisionWorkflowPlan(
    managedFile
      ? {
          ...input,
          workflowPath: managedFile.path,
          ...(claudeSubscriptionSelected
            ? { actionRef: dependencies.claudeSubscriptionActionRef! }
            : {}),
        }
      : input,
  );
  const actionVersion = gatewaySelected
    ? reviewRouterWorkflowContract.channel
    : plan.actionRef;
  if (plan.codexRotatingProviderInstanceId) {
    renderCanonicalCodexRotatingInteractionWorkflowV3({
      actionRef: plan.actionRef,
      apiUrl: plan.apiUrl,
      runtimeConfigMode: plan.runtimeConfigMode,
    });
  }

  // What the workflow this attempt renders requires, not what the policy does.
  const attemptTransport: WorkflowTransport = gatewaySelected
    ? "gateway"
    : providerApiSelected
      ? "provider_api"
      : plan.codexRotatingProviderInstanceId
        ? "rotating"
        : "ci_secrets";
  const attemptRequirement = claudeSubscriptionSelected
    ? workflowRequirement("ci_secrets", ["claude"])
    : renderedWorkflowRequirement(
        attemptTransport,
        plan.staticRuntimeEnv,
        selectedProviderApiMode,
      );
  const attempt = await dependencies.provisioning.beginAttempt({
    workspaceId: plan.workspaceId,
    repositoryId: plan.repositoryId,
    installationId: plan.installationId,
    status: "not_started",
    branch: plan.setupBranch,
    workflowPath: plan.workflowPath,
    workflowStyle: plan.workflowStyle,
    actionVersion,
    workflowRequirement: attemptRequirement,
  });

  if (dependencies.enabled === false) {
    await dependencies.provisioning.markFailed({
      ...attempt,
      workspaceId: plan.workspaceId,
      repositoryId: plan.repositoryId,
      status: "failed",
      branch: attempt.branch,
      workflowPath: plan.workflowPath,
      workflowStyle: plan.workflowStyle,
      actionVersion,
      workflowRequirement: attemptRequirement,
      pullRequestUrl: null,
      errorMessage: "workflow_provisioning_disabled",
    });
    if (dependencies.auditLog) {
      await recordAuditEvent(
        {
          workspaceId: plan.workspaceId,
          actor: dependencies.actor ?? "system:workflow-provisioning",
          action: "workflow.setup_pr_blocked",
          targetType: "repository",
          targetId: plan.repositoryId,
          metadata: {
            reason: "workflow_provisioning_disabled",
            ...(dependencies.auditMetadata ?? {}),
          },
        },
        { auditLog: dependencies.auditLog },
      );
    }
    throw new Error("workflow_provisioning_disabled");
  }

  try {
    if (
      !managedFile &&
      plan.runtimeConfigMode === "static" &&
      plan.staticRuntimeEnv === undefined
    ) {
      throw new Error("workflow_static_policy_required");
    }
    const staticRuntimeEnv = managedFile ? {} : (plan.staticRuntimeEnv ?? {});
    if (!managedFile) {
      assertProductionCodexWorkflowProvisioningAllowed({
        codexRotatingProviderInstanceId: plan.codexRotatingProviderInstanceId,
        staticRuntimeEnv,
      });
    }

    const workflowFiles = managedFile
      ? [
          {
            path: defaultCodexRotatingWorkflowPath,
            operation: "delete" as const,
            markerGroups: getObsoleteGatewayCallerDeletionMarkerGroups(),
          },
          {
            path: defaultWorkflowPath,
            operation: "delete" as const,
            markerGroups: getLegacyReviewRouterWorkflowDeletionMarkerGroups(),
          },
          {
            path: defaultInteractionWorkflowPath,
            operation: "delete" as const,
            markerGroups:
              getLegacyReviewRouterInteractionWorkflowDeletionMarkerGroups(),
          },
          managedFile,
        ]
      : renderReviewRouterWorkflowFiles({
          ...(!plan.codexRotatingProviderInstanceId &&
          !plan.conflictReviewFallbackEnabled &&
          !plan.forkAgenticSandboxEnabled &&
          plan.runtimeConfigMode === "oidc" &&
          (plan.workflowStyle ?? "reusable") === "reusable" &&
          dependencies.secretsRuntimeActionRef
            ? { secretsRuntimeActionRef: dependencies.secretsRuntimeActionRef }
            : {}),
          actionRef: plan.actionRef,
          apiUrl: plan.apiUrl,
          runtimeConfigMode: plan.runtimeConfigMode,
          workflowStyle: plan.workflowStyle,
          conflictReviewFallbackEnabled:
            plan.conflictReviewFallbackEnabled === true,
          forkAgenticSandboxEnabled: plan.forkAgenticSandboxEnabled === true,
          ...(plan.codexRotatingProviderInstanceId
            ? {
                codexRotatingProviderInstanceId:
                  plan.codexRotatingProviderInstanceId,
                codexRotatingWorkflowPath: plan.workflowPath,
                ...(plan.codexRotatingWorkflowSecretNamespace
                  ? {
                      codexRotatingActiveSecretNamespace:
                        plan.codexRotatingWorkflowSecretNamespace,
                    }
                  : {}),
              }
            : {}),
          ...(plan.codexRotatingReviewActionV2Mode
            ? {
                codexRotatingReviewActionV2Mode:
                  plan.codexRotatingReviewActionV2Mode,
              }
            : {}),
          ...(plan.codexRotatingWorkflowSchemaVersion !== undefined
            ? {
                codexRotatingWorkflowSchemaVersion:
                  plan.codexRotatingWorkflowSchemaVersion,
              }
            : {}),
          staticRuntimeEnv,
        });

    const pullRequest =
      await dependencies.setupGateway.createOrUpdateSetupPullRequest({
        owner: plan.owner,
        repo: plan.name,
        baseBranch: plan.defaultBranch,
        setupBranch: attempt.branch,
        ...(managedFile
          ? {
              setupMode: gatewaySelected
                ? ("gateway" as const)
                : claudeSubscriptionSelected
                  ? ("claude_subscription" as const)
                  : ("provider_api" as const),
            }
          : {}),
        workflowFiles,
      });

    await dependencies.provisioning.markSetupPullRequestOpen({
      ...attempt,
      workspaceId: plan.workspaceId,
      repositoryId: plan.repositoryId,
      status: "setup_pr_open",
      branch: pullRequest.branch,
      workflowPath: plan.workflowPath,
      workflowStyle: plan.workflowStyle,
      actionVersion,
      workflowRequirement: attemptRequirement,
      pullRequestUrl: pullRequest.url,
      pullRequestHeadSha: pullRequest.headSha,
      errorMessage: null,
    });
    if (dependencies.auditLog) {
      await recordAuditEvent(
        {
          workspaceId: plan.workspaceId,
          actor: dependencies.actor ?? "system:workflow-provisioning",
          action: "workflow.setup_pr_opened",
          targetType: "repository",
          targetId: plan.repositoryId,
          metadata: {
            branch: pullRequest.branch,
            workflowPath: plan.workflowPath,
            workflowStyle: plan.workflowStyle,
            actionVersion,
            pullRequestUrl: pullRequest.url,
            ...(dependencies.auditMetadata ?? {}),
          },
        },
        { auditLog: dependencies.auditLog },
      );
    }

    return pullRequest;
  } catch (error: unknown) {
    const message = safeWorkflowProvisioningErrorSummary(error);
    await dependencies.provisioning.markFailed({
      ...attempt,
      workspaceId: plan.workspaceId,
      repositoryId: plan.repositoryId,
      status: "failed",
      branch: attempt.branch,
      workflowPath: plan.workflowPath,
      workflowStyle: plan.workflowStyle,
      actionVersion,
      workflowRequirement: attemptRequirement,
      pullRequestUrl: null,
      errorMessage: message,
    });
    if (dependencies.auditLog) {
      await recordAuditEvent(
        {
          workspaceId: plan.workspaceId,
          actor: dependencies.actor ?? "system:workflow-provisioning",
          action: "workflow.setup_pr_failed",
          targetType: "repository",
          targetId: plan.repositoryId,
          metadata: {
            branch: attempt.branch,
            workflowPath: plan.workflowPath,
            workflowStyle: plan.workflowStyle,
            actionVersion,
            errorSummary: message.slice(0, 500),
            ...(dependencies.auditMetadata ?? {}),
          },
        },
        { auditLog: dependencies.auditLog },
      );
    }
    throw error;
  }
}

function assertProductionCodexWorkflowProvisioningAllowed(input: {
  readonly codexRotatingProviderInstanceId?: string | undefined;
  readonly staticRuntimeEnv: Readonly<Record<string, string>>;
}): void {
  const authMode = input.staticRuntimeEnv.REVIEW_AUTH_MODE;
  if (authMode === "codex-oauth") {
    throw new Error("codex_legacy_auth_requires_reconnect");
  }
  if (authMode === "openai-api") {
    throw new Error("codex_api_key_setup_disabled");
  }
  if (
    authMode === "codex-oauth-rotating" &&
    !input.codexRotatingProviderInstanceId
  ) {
    throw new Error("codex_rotating_provider_instance_required");
  }
}

function safeWorkflowProvisioningErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("workflow_delete_untrusted:")) {
    return "workflow_delete_untrusted";
  }
  if (
    [
      "invalid_workflow_action_ref",
      "invalid_reusable_workflow_action_ref",
      "invalid_reusable_workflow_runtime_ref",
      "invalid_conflict_review_reusable_workflow_runtime_ref",
      "invalid_workflow_api_url",
      "invalid_workflow_env_key",
      "invalid_workflow_env_value",
      "workflow_provisioning_disabled",
      "conflict_review_explicit_workflow_unsupported",
      "codex_legacy_auth_requires_reconnect",
      "codex_api_key_setup_disabled",
      "codex_rotating_provider_instance_required",
      "codex_rotating_action_ref_invalid",
      "codex_rotating_action_ref_must_be_full_sha",
      "codex_rotating_conflict_review_unsupported",
    ].includes(message)
  ) {
    return message;
  }

  const status = getHttpStatus(error);
  if (status >= 400 && status <= 599) {
    return `github_api_error:${status}`;
  }

  return "workflow_provisioning_failed";
}

function getHttpStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 0;
}
