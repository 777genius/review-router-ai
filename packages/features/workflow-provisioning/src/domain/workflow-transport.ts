import { codexRotatingAuthMode } from "@reviewrouter/features-codex-oauth-rotating";
import {
  isOpenRouterDirectConfiguration,
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import type { ProviderKind } from "@reviewrouter/features-review-providers";
import { hostedPoolSessionMode } from "./hosted-pool-workflow-template";
import { codexRotatingProviderSecretInputsForRuntimeEnv } from "./workflow-template";

/** How a repository workflow receives the credentials of its provider. */
export type WorkflowTransport =
  | "gateway"
  | "provider_api"
  | "rotating"
  | "hosted_pool"
  | "ci_secrets";

/**
 * What a repository workflow is rendered for: its transport plus the provider
 * kinds whose secrets or steps the rendered file carries, joined with `+`
 * (for example `ci_secrets+codex-mimo`). Requirements are compared, never
 * parsed by readers, to derive whether an installed workflow must be updated.
 */
export type WorkflowRequirement = string;

const workflowRequirementPattern =
  /^(?:gateway|provider_api|rotating|hosted_pool|ci_secrets)(?:\+[a-z][a-z0-9-]{0,31}){0,4}$/;

/**
 * The transport an effective configuration needs. Gateway and provider-API
 * workflows share one path, rotating and hosted pool share another, so the
 * transport is never derived from a workflow path. A transport that owns the
 * whole review (Gateway, provider API) refuses any other provider row.
 */
export function requiredWorkflowTransport(
  config: ReviewConfiguration,
): WorkflowTransport {
  if (
    config.providers.some(
      (provider) => provider.authMode === "codex_account_gateway",
    )
  ) {
    const parsed = parseReviewConfigurationStrict(config);
    if (
      parsed.providers.length !== 1 ||
      parsed.providers[0]?.authMode !== "codex_account_gateway"
    ) {
      throw new Error("account_gateway_single_provider_required");
    }
    return "gateway";
  }
  if (isOpenRouterDirectConfiguration(config)) return "provider_api";
  if (
    config.providers.some(
      (provider) => provider.authMode === codexRotatingAuthMode,
    )
  ) {
    return "rotating";
  }
  if (
    config.providers.some(
      (provider) => provider.authMode === hostedPoolSessionMode,
    )
  ) {
    return "hosted_pool";
  }
  return "ci_secrets";
}

/** The requirement of the workflow an effective configuration needs. */
export function requiredWorkflowRequirement(
  config: ReviewConfiguration,
): WorkflowRequirement {
  const transport = requiredWorkflowTransport(config);
  return workflowRequirement(
    transport,
    workflowProviderVariants(transport, config),
  );
}

/**
 * The provider kinds a workflow of the given transport is rendered for: a
 * CI-secret workflow carries the secret and steps of its primary secret
 * provider, a rotating workflow passes through the secrets of its hybrid
 * providers. Other transports render the same file for every configuration.
 */
export function workflowProviderVariants(
  transport: WorkflowTransport,
  config: ReviewConfiguration,
): readonly ProviderKind[] {
  if (transport === "ci_secrets") {
    const providerKind = ciSecretsWorkflowProviderKind(config);
    return providerKind ? [providerKind] : [];
  }
  if (transport === "rotating")
    return rotatingWorkflowSecretProviderKinds(config);
  return [];
}

/** The provider whose secret and steps a CI-secret workflow is rendered for. */
export function ciSecretsWorkflowProviderKind(
  config: ReviewConfiguration,
): "codex-mimo" | "claude" | undefined {
  if (config.providers.some((provider) => provider.kind === "codex-mimo"))
    return "codex-mimo";
  return config.providers.some((provider) => provider.kind === "claude")
    ? "claude"
    : undefined;
}

/** Hybrid providers whose secrets a rotating workflow passes through. */
export function rotatingWorkflowSecretProviderKinds(
  config: ReviewConfiguration,
): readonly ("claude" | "codex-mimo" | "openrouter")[] {
  return (["claude", "codex-mimo", "openrouter"] as const).filter((kind) =>
    config.providers.some((provider) => provider.kind === kind),
  );
}

/**
 * The requirement of a workflow rendered with this static runtime env: the
 * templates derive their provider secrets and steps from it, so an attempt
 * records exactly what its file carries.
 */
export function renderedWorkflowRequirement(
  transport: WorkflowTransport,
  staticRuntimeEnv: Readonly<Record<string, string>> | undefined,
): WorkflowRequirement {
  if (transport !== "ci_secrets" && transport !== "rotating")
    return workflowRequirement(transport, []);
  const secrets =
    codexRotatingProviderSecretInputsForRuntimeEnv(staticRuntimeEnv);
  if (transport === "ci_secrets")
    return workflowRequirement(
      transport,
      secrets.mimoTokenPlanApiKeySecret
        ? ["codex-mimo"]
        : secrets.claudeCodeOAuthTokenSecret
          ? ["claude"]
          : [],
    );
  return workflowRequirement(transport, [
    ...(secrets.claudeCodeOAuthTokenSecret ? (["claude"] as const) : []),
    ...(secrets.mimoTokenPlanApiKeySecret ? (["codex-mimo"] as const) : []),
    ...(secrets.openRouterApiKeySecret ? (["openrouter"] as const) : []),
  ]);
}

export function workflowRequirement(
  transport: WorkflowTransport,
  providerKinds: readonly ProviderKind[],
): WorkflowRequirement {
  const variants = [
    ...new Set(providerKinds.filter((kind) => kind !== "codex")),
  ].sort();
  const requirement = [transport, ...variants].join("+");
  if (!workflowRequirementPattern.test(requirement))
    throw new Error("workflow_requirement_invalid");
  return requirement;
}
