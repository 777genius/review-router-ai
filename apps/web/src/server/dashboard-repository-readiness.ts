import {
  resolveEffectiveProviderReadiness,
  type EffectiveProviderReadiness,
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
import {
  repositorySearchReadiness,
  type RepositorySearchReadiness,
} from "./repository-search";
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
    readiness: RepositorySearchReadiness;
  }>;

/**
 * The one composition of readiness facts shared by the dashboard page and the
 * repository search route, so both show the same setup step and filter bucket.
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
    const gatewayAuthorizationReady = isGatewayReviewV2RepositoryReady(
      input.gatewayReadiness.get(repository.id),
    );
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
      gatewayAuthorizationReady,
      providerSecretCheckFailed:
        repository.fullName ===
        input.providerSecretCheckFailedRepositoryFullName,
    });
    return {
      ...readiness,
      repository,
      readiness: repositorySearchReadiness({
        setupProgressStep: readiness.step,
        healthStatus: readiness.healthStatus,
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
