import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";

/** Repository setup steps in stepper order. */
export type RepositorySetupStepId =
  | "setup_pr"
  | "merge_setup_pr"
  | "provider"
  | "ready";

/** Health report statuses of the repo-health read model. */
export type ProviderReadinessHealthStatus =
  | "healthy"
  | "setup_pr_open"
  | "missing_workflow"
  | "version_mismatch"
  | "workflow_check_unavailable"
  | "provider_needs_setup"
  | "provider_unhealthy"
  | "provider_report_stale"
  | "needs_attention";

/** A cached setup row of one provider of the repository. */
export type ProviderSetupEvidence = Readonly<{
  providerKind: string;
  authMode: string;
  state: string;
  updatedAt: Date;
}>;

/**
 * Plain facts about one repository. Callers compose them from their own reads;
 * nothing here knows how a configuration, workflow or account is stored.
 */
export type EffectiveProviderReadinessFacts = Readonly<{
  /** Provider rows of the effective configuration; null when none applies. */
  providers:
    | readonly Readonly<{
        kind: string;
        authMode: ProviderAuthMode;
      }>[]
    | null;
  /**
   * What the configuration needs the workflow to be rendered for, and what
   * the installed workflow was rendered for. Only compared; null is unknown.
   */
  requiredWorkflowRequirement: string | null;
  installedWorkflowRequirement: string | null;
  setupStatus: string;
  setupNeedsAttention: boolean;
  healthStatus: ProviderReadinessHealthStatus | undefined;
  latestActionHealthReceivedAt: Date | null;
  providerSetup: readonly ProviderSetupEvidence[];
  hostedSessionReady: boolean;
  gatewayAccountReady: boolean;
  gatewayAuthorizationReady: boolean;
  providerSecretCheckFailed: boolean;
}>;

export type EffectiveProviderReadiness = Readonly<{
  /** The health report with provider evidence applied. */
  healthStatus: ProviderReadinessHealthStatus | undefined;
  workflowCurrent: boolean;
  workflowUpdateRequired: boolean;
  step: RepositorySetupStepId;
}>;

const workflowCurrentHealthStatuses: ReadonlySet<
  ProviderReadinessHealthStatus | undefined
> = new Set([
  "healthy",
  "provider_needs_setup",
  "provider_unhealthy",
  "provider_report_stale",
]);

/** Display readiness only; setup and admission recheck their own authority. */
export function resolveEffectiveProviderReadiness(
  facts: EffectiveProviderReadinessFacts,
): EffectiveProviderReadiness {
  const workflowUpdateRequired =
    facts.requiredWorkflowRequirement !== null &&
    facts.installedWorkflowRequirement !== null &&
    facts.requiredWorkflowRequirement !== facts.installedWorkflowRequirement;
  const gatewayProvider =
    facts.providers?.some(
      (provider) => provider.authMode === "codex_account_gateway",
    ) ?? false;
  const providerSetupConfirmedAt = facts.providers
    ? confirmedProviderSetupAt(facts.providers, facts.providerSetup)
    : null;
  const healthStatus = providerAdjustedHealthStatus({
    healthStatus: facts.healthStatus,
    gatewayProvider,
    gatewayAccountReady: facts.gatewayAccountReady,
    hostedSessionReady: facts.hostedSessionReady,
    providerSetupConfirmed: providerSetupConfirmedAt !== null,
  });
  const workflowCurrent =
    !workflowUpdateRequired && workflowCurrentHealthStatuses.has(healthStatus);
  const providerReady = gatewayProvider
    ? facts.gatewayAccountReady
    : facts.hostedSessionReady ||
      (providerSetupConfirmedAt !== null &&
        !facts.providerSecretCheckFailed &&
        (!facts.latestActionHealthReceivedAt ||
          providerSetupConfirmedAt >= facts.latestActionHealthReceivedAt));

  return {
    healthStatus,
    workflowCurrent,
    workflowUpdateRequired,
    step: setupStep({
      setupStatus: facts.setupStatus,
      setupNeedsAttention: facts.setupNeedsAttention,
      healthStatus,
      workflowCurrent,
      workflowUpdateRequired,
      providerReady,
      gatewayAuthorizationPending:
        gatewayProvider && !facts.gatewayAuthorizationReady,
    }),
  };
}

/**
 * Every provider of the configuration needs a matching row and any matching
 * row that is not configured blocks it. Rows of other providers are ignored.
 */
function confirmedProviderSetupAt(
  providers: NonNullable<EffectiveProviderReadinessFacts["providers"]>,
  providerSetup: readonly ProviderSetupEvidence[],
): Date | null {
  const expectedKeys = new Set(
    providers.map((provider) =>
      providerSetupKey(provider.kind, provider.authMode),
    ),
  );
  const matching = providerSetup.filter((item) =>
    expectedKeys.has(providerSetupKey(item.providerKind, item.authMode)),
  );
  const coveredKeys = new Set(
    matching.map((item) => providerSetupKey(item.providerKind, item.authMode)),
  );
  if (
    matching.length === 0 ||
    coveredKeys.size < expectedKeys.size ||
    matching.some((item) => item.state !== "configured")
  ) {
    return null;
  }
  return matching
    .map((item) => item.updatedAt)
    .reduce((latest, updatedAt) => (updatedAt > latest ? updatedAt : latest));
}

function providerAdjustedHealthStatus(input: {
  readonly healthStatus: ProviderReadinessHealthStatus | undefined;
  readonly gatewayProvider: boolean;
  readonly gatewayAccountReady: boolean;
  readonly hostedSessionReady: boolean;
  readonly providerSetupConfirmed: boolean;
}): ProviderReadinessHealthStatus | undefined {
  if (input.gatewayProvider) {
    // A Gateway binding replaces legacy secret readiness, not actual health failures.
    return input.healthStatus === "healthy" && !input.gatewayAccountReady
      ? "provider_needs_setup"
      : input.healthStatus;
  }
  if (input.hostedSessionReady) {
    return input.healthStatus === undefined ||
      input.healthStatus === "healthy" ||
      input.healthStatus === "provider_needs_setup"
      ? "healthy"
      : input.healthStatus;
  }
  if (input.healthStatus !== "healthy") return input.healthStatus;
  return input.providerSetupConfirmed ? "healthy" : "provider_needs_setup";
}

function setupStep(input: {
  readonly setupStatus: string;
  readonly setupNeedsAttention: boolean;
  readonly healthStatus: ProviderReadinessHealthStatus | undefined;
  readonly workflowCurrent: boolean;
  readonly workflowUpdateRequired: boolean;
  readonly providerReady: boolean;
  readonly gatewayAuthorizationPending: boolean;
}): RepositorySetupStepId {
  if (input.setupNeedsAttention) return "setup_pr";
  // A report from the previous workflow says nothing about the required one.
  if (
    !input.workflowUpdateRequired &&
    (input.healthStatus === "healthy" ||
      (input.workflowCurrent && input.providerReady))
  ) {
    // Gateway reviews also need their hosted review authorization.
    return input.gatewayAuthorizationPending ? "provider" : "ready";
  }
  if (input.workflowCurrent) return "provider";
  return input.setupStatus === "setup_pr_open" ||
    input.healthStatus === "setup_pr_open"
    ? "merge_setup_pr"
    : "setup_pr";
}

function providerSetupKey(kind: string, authMode: string): string {
  return `${kind}:${authMode}`;
}
