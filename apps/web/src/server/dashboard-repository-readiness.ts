import {
  resolveEffectiveProviderReadiness,
  type EffectiveProviderReadiness,
  type GatewayAuthorizationState,
} from "@reviewrouter/features-provider-setup";
import type { RepositoryHealthStatus } from "@reviewrouter/features-repo-health";
import type {
  EffectiveReviewConfiguration,
  ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  comparableWorkflowRequirement,
  inspectRequiredWorkflowRequirement,
  type WorkflowRequirement,
} from "@reviewrouter/features-workflow-provisioning";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";
import {
  isGatewayProviderSetupReady,
  type DashboardProviderSetupReadinessRecord,
} from "./dashboard-provider-setup-readiness";
import {
  isHostedWorkspacePoolSessionReady,
  type HostedPoolRepositoryView,
} from "./hosted-pool-dashboard";
import {
  isGatewayReviewV2RepositoryReady,
  type GatewayReviewV2RepositoryReadiness,
} from "./prisma-gateway-review-v2-provisioning";
import { describeRepositoryHealth } from "./repository-health-view";
import {
  isRepositoryAvailableForSetup,
  repositorySetupState,
  type RepositorySetupState,
} from "../features/repository-setup/repository-setup-state";
import {
  installedReviewRuntimeCompatibility,
  type DashboardRuntimeReleases,
} from "./review-runtime-readiness";

/**
 * The effective configuration of each repository as the single resolver
 * reads it; null when the repository selects no provider (nor inherits one)
 * or its policy must be saved again. Nothing falls back to the workspace.
 */
export type DashboardRepositoryConfigs = Readonly<{
  effectiveConfigs: ReadonlyMap<string, ReviewConfiguration | null>;
}>;

export function dashboardRepositoryConfigs(
  repositories: ReadonlyMap<string, EffectiveReviewConfiguration>,
): DashboardRepositoryConfigs {
  return {
    effectiveConfigs: new Map(
      [...repositories].map(
        ([repositoryId, resolved]) =>
          [
            repositoryId,
            resolved.status === "ready" ? resolved.config : null,
          ] as const,
      ),
    ),
  };
}

export type DashboardReadinessRepository = Readonly<{
  id: string;
  fullName: string;
  provider: string;
  selected: boolean;
  archived: boolean;
  setupStatus: string;
  setupNeedsAttention: boolean;
  /** What the installed workflow was rendered for; null when not recorded. */
  installedWorkflowRequirement: WorkflowRequirement | null;
  workflowProvisioning?: Readonly<{
    status: string;
    actionVersion: string;
  }> | null;
}>;

export type DashboardRepositoryReadiness<
  Repository extends DashboardReadinessRepository,
> = EffectiveProviderReadiness &
  Readonly<{
    repository: Repository;
    state: RepositorySetupState;
  }>;

/**
 * The one composition of readiness facts: the setup step of each repository
 * row and the state its counts, filter and order use.
 */
export function resolveDashboardRepositoryReadiness<
  Repository extends DashboardReadinessRepository,
>(
  input: DashboardRepositoryConfigs &
    Readonly<{
      repositories: readonly Repository[];
      health: readonly Readonly<{
        repositoryId: string;
        status: RepositoryHealthStatus;
        latestActionHealthReceivedAt?: Date | null;
      }>[];
      providerSetup: readonly DashboardProviderSetupReadinessRecord[];
      hostedRepositories: readonly Pick<
        HostedPoolRepositoryView,
        "id" | "source" | "activation"
      >[];
      gatewayAccounts: AccountsResult<AccountsPage> | undefined;
      gatewayReadiness: ReadonlyMap<string, GatewayReviewV2RepositoryReadiness>;
      runtimeReleases?: DashboardRuntimeReleases | null;
      providerSecretCheckFailedRepositoryFullName: string | null;
    }>,
): readonly DashboardRepositoryReadiness<Repository>[] {
  const effectiveConfig = (repositoryId: string) =>
    input.effectiveConfigs.get(repositoryId) ?? null;
  const healthByRepositoryId = new Map(
    input.health.map((item) => [item.repositoryId, item] as const),
  );
  const hostedByRepositoryId = new Map(
    input.hostedRepositories.map((item) => [item.id, item] as const),
  );
  const providerSetupByRepositoryId = new Map<
    string,
    DashboardProviderSetupReadinessRecord[]
  >();
  for (const item of input.providerSetup) {
    if (!item.repositoryId) continue;
    providerSetupByRepositoryId.set(item.repositoryId, [
      ...(providerSetupByRepositoryId.get(item.repositoryId) ?? []),
      item,
    ]);
  }

  return input.repositories.map((repository) => {
    const config = effectiveConfig(repository.id);
    const health = healthByRepositoryId.get(repository.id);
    const hosted = hostedByRepositoryId.get(repository.id);
    // A hosted pool binding moves between its hosted and rotating workflows.
    const transition = {
      hostedPoolTransition: hosted?.source === "hosted_workspace_pool",
    };
    const required = config ? knownWorkflowRequirement(config) : null;
    const installed = repository.installedWorkflowRequirement;
    const requiredComparable =
      required && comparableWorkflowRequirement(required, transition);
    const installedComparable =
      installed && comparableWorkflowRequirement(installed, transition);
    const gatewayReadiness = input.gatewayReadiness.get(repository.id);
    const gatewayAuthorizationReady =
      isGatewayReviewV2RepositoryReady(gatewayReadiness);
    const readiness = resolveEffectiveProviderReadiness({
      providers: config?.providers ?? null,
      requiredWorkflowRequirement: requiredComparable,
      installedWorkflowRequirement: installedComparable,
      runtimeCompatibility: installedReviewRuntimeCompatibility({
        providers: config?.providers ?? null,
        provisioning: repository.workflowProvisioning ?? null,
        requirementMatches:
          requiredComparable !== null &&
          requiredComparable === installedComparable,
        releases: input.runtimeReleases ?? null,
        gatewayAuthorizationReady,
      }),
      setupStatus: repository.setupStatus,
      setupNeedsAttention: repository.setupNeedsAttention,
      healthStatus: health?.status,
      latestActionHealthReceivedAt:
        health?.latestActionHealthReceivedAt ?? null,
      providerSetup: providerSetupByRepositoryId.get(repository.id) ?? [],
      hostedSessionReady: isHostedWorkspacePoolSessionReady(hosted),
      gatewayAccountReady: config
        ? isGatewayProviderSetupReady(config, input.gatewayAccounts)
        : false,
      gatewayAuthorization: gatewayAuthorizationState(gatewayReadiness),
      providerSecretCheckFailed:
        repository.fullName ===
        input.providerSecretCheckFailedRepositoryFullName,
    });
    const healthView = describeRepositoryHealth(readiness.healthStatus);
    return {
      ...readiness,
      repository,
      state: repositorySetupState({
        available: isRepositoryAvailableForSetup(repository),
        step: readiness.step,
        healthDanger: healthView.tone === "danger",
        healthBlocksReview: healthView.blocksReview,
        setupNeedsAttention: repository.setupNeedsAttention,
        gatewayAuthorization: readiness.gatewayAuthorization,
        gatewayAccountsRead: input.gatewayAccounts?.status === "ok",
        setupStarted:
          repository.workflowProvisioning != null ||
          repository.setupStatus !== "not_configured",
      }),
    };
  });
}

/** Repositories whose readiness depends on Account Gateway facts. */
export function gatewayReviewRepositoryIds(
  input: DashboardRepositoryConfigs &
    Readonly<{ repositoryIds: readonly string[] }>,
): string[] {
  return input.repositoryIds.filter((repositoryId) =>
    input.effectiveConfigs
      .get(repositoryId)
      ?.providers.some(
        (provider) => provider.authMode === "codex_account_gateway",
      ),
  );
}

/**
 * A missing authority or repository identity is what a merged setup has before
 * its verification; every other refusal is an operator state (pause, drain,
 * legacy enrollment, safety block) that verification does not clear.
 */
function gatewayAuthorizationState(
  readiness: GatewayReviewV2RepositoryReadiness | undefined,
): GatewayAuthorizationState {
  if (!readiness) return "not_established";
  if (readiness.status === "ready") return "ready";
  return "issue" in readiness &&
    (readiness.issue === "mutation_authority_unavailable" ||
      readiness.issue === "gateway_repository_identity_missing")
    ? "not_established"
    : "blocked";
}

function knownWorkflowRequirement(
  config: ReviewConfiguration,
): WorkflowRequirement | null {
  try {
    const requirement = inspectRequiredWorkflowRequirement(config);
    return typeof requirement === "string" ? requirement : null;
  } catch {
    // Setup refuses an unsupported provider mix with its own error.
    return null;
  }
}
