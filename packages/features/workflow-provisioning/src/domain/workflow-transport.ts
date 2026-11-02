import {
  providerApiDescriptors,
  type ProviderApiAuthMode,
} from "@reviewrouter/shared";
import { codexRotatingAuthMode } from "@reviewrouter/features-codex-oauth-rotating";
import {
  inspectProviderApiDirectConfiguration,
  type ProviderApiConfigurationUnsupported,
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
export type WorkflowTransportInspection =
  | WorkflowTransport
  | ProviderApiConfigurationUnsupported;

/** Inspect historical policies without rewriting them or choosing a fallback. */
export function inspectRequiredWorkflowTransport(
  config: ReviewConfiguration,
): WorkflowTransportInspection {
  if (
    config.providers.some(
      (provider) => provider.authMode === "codex_account_gateway",
    )
  ) {
    const parsed = parseReviewConfigurationStrict(config);
    if (
      !parsed.providers.every(
        (provider) => provider.authMode === "codex_account_gateway",
      )
    ) {
      throw new Error("account_gateway_mixed_transport_unsupported");
    }
    return "gateway";
  }
  const direct = inspectProviderApiDirectConfiguration(config);
  if (direct.status === "unsupported") return direct;
  if (direct.status === "supported") return "provider_api";
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

/** Setup operations keep their existing domain-error boundary. */
export function requiredWorkflowTransport(
  config: ReviewConfiguration,
): WorkflowTransport {
  const transport = inspectRequiredWorkflowTransport(config);
  if (typeof transport !== "string") throw new Error(transport.reason);
  return transport;
}

/** The requirement of the workflow an effective configuration needs. */
export function inspectRequiredWorkflowRequirement(
  config: ReviewConfiguration,
): WorkflowRequirement | ProviderApiConfigurationUnsupported {
  const transport = inspectRequiredWorkflowTransport(config);
  return typeof transport === "string"
    ? workflowRequirement(
        transport,
        workflowProviderVariants(transport, config),
      )
    : transport;
}

/** Strict setup/migration compatibility wrapper; reads inspect the result. */
export function requiredWorkflowRequirement(
  config: ReviewConfiguration,
): WorkflowRequirement {
  const requirement = inspectRequiredWorkflowRequirement(config);
  if (typeof requirement !== "string") throw new Error(requirement.reason);
  return requirement;
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
  if (transport === "provider_api")
    return config.providers[0] ? [config.providers[0].kind] : [];
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

/** The native subscription caller has one credential and one selected model. */
export function isClaudeSubscriptionConfiguration(
  config: ReviewConfiguration,
): boolean {
  return (
    config.providers.length === 1 &&
    config.providers[0]?.kind === "claude" &&
    config.providers[0].authMode === "claude_code_oauth"
  );
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
  providerApiAuthMode?: ProviderApiAuthMode,
): WorkflowRequirement {
  if (transport === "provider_api")
    return workflowRequirement(
      transport,
      providerApiAuthMode
        ? [providerApiDescriptors[providerApiAuthMode].providerKind]
        : [],
    );
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

/**
 * The requirement of an installed workflow, taken from the artifact that was
 * actually verified rather than from the policy read before it: a hosted pool
 * confirmation may install the rotating workflow and switch the policy only
 * afterwards, and the reverse.
 */
export function verifiedWorkflowRequirement(input: {
  /** The managed route (Gateway, provider API) the verified caller uses. */
  readonly managedTransport: "gateway" | "provider_api" | null;
  readonly providerApiAuthMode?: ProviderApiAuthMode;
  /** A verified Codex subscription workflow; null for a CI-secret workflow. */
  readonly codexWorkflow: Readonly<{ hosted: boolean }> | null;
  readonly config: ReviewConfiguration;
}): WorkflowRequirement {
  const transport: WorkflowTransport =
    input.managedTransport ??
    (input.codexWorkflow
      ? input.codexWorkflow.hosted
        ? "hosted_pool"
        : "rotating"
      : "ci_secrets");
  return workflowRequirement(
    transport,
    transport === "provider_api"
      ? input.providerApiAuthMode
        ? [providerApiDescriptors[input.providerApiAuthMode].providerKind]
        : []
      : workflowProviderVariants(transport, input.config),
  );
}

/**
 * The requirement compared for "workflow update required". While a hosted
 * pool binding moves a repository between its hosted and rotating workflows,
 * the policy and the workflow switch at different moments; both Codex
 * subscription workflows then count as one family, so a half-finished switch
 * never asks for a setup PR under the old policy.
 */
export function comparableWorkflowRequirement(
  requirement: WorkflowRequirement,
  options: Readonly<{ hostedPoolTransition: boolean }>,
): WorkflowRequirement {
  if (!options.hostedPoolTransition) return requirement;
  const transport = requirement.split("+", 1)[0];
  return transport === "rotating" || transport === "hosted_pool"
    ? "codex_subscription"
    : requirement;
}
