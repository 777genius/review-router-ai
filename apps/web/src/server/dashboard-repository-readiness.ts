import {
  resolveEffectiveProviderReadiness,
  type EffectiveProviderReadiness,
} from "@reviewrouter/features-provider-setup";
import type { RepositoryHealthStatus } from "@reviewrouter/features-repo-health";
import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import {
  requiredWorkflowTransport,
  type WorkflowTransport,
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

/** Saved policies as the dashboard reads them for one workspace. */
export type DashboardRepositoryConfigs = Readonly<{
  activeConfig: ReviewConfiguration | null;
  repositoryConfigs: readonly Readonly<{
    repositoryId: string;
    config: { readonly config: ReviewConfiguration } | null;
  }>[];
}>;

export type DashboardReadinessRepository = Readonly<{
  id: string;
  fullName: string;
  setupStatus: string;
  setupNeedsAttention: boolean;
  /** Transport of the installed workflow; null when not recorded. */
  installedTransport: WorkflowTransport | null;
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
      providerSecretCheckFailedRepositoryFullName: string | null;
    }>,
): readonly DashboardRepositoryReadiness<Repository>[] {
  const effectiveConfig = effectiveRepositoryConfigs(input);
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
    const readiness = resolveEffectiveProviderReadiness({
      providers: config?.providers ?? null,
      requiredTransport: config ? knownWorkflowTransport(config) : null,
      installedTransport: repository.installedTransport,
      setupStatus: repository.setupStatus,
      setupNeedsAttention: repository.setupNeedsAttention,
      healthStatus: health?.status,
      latestActionHealthReceivedAt:
        health?.latestActionHealthReceivedAt ?? null,
      providerSetup: providerSetupByRepositoryId.get(repository.id) ?? [],
      hostedSessionReady: isHostedWorkspacePoolSessionReady(
        hostedByRepositoryId.get(repository.id),
      ),
      gatewayAccountReady: config
        ? isGatewayProviderSetupReady(config, input.gatewayAccounts)
        : false,
      gatewayAuthorizationReady: isGatewayReviewV2RepositoryReady(
        input.gatewayReadiness.get(repository.id),
      ),
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
  const effectiveConfig = effectiveRepositoryConfigs(input);
  return input.repositoryIds.filter((repositoryId) =>
    effectiveConfig(repositoryId)?.providers.some(
      (provider) => provider.authMode === "codex_account_gateway",
    ),
  );
}

// A repository without a readable override of its own follows the workspace.
function effectiveRepositoryConfigs(
  configs: DashboardRepositoryConfigs,
): (repositoryId: string) => ReviewConfiguration | null {
  const overrides = new Map(
    configs.repositoryConfigs.map(
      (item) => [item.repositoryId, item.config?.config] as const,
    ),
  );
  return (repositoryId) => overrides.get(repositoryId) ?? configs.activeConfig;
}

function knownWorkflowTransport(
  config: ReviewConfiguration,
): WorkflowTransport | null {
  try {
    return requiredWorkflowTransport(config);
  } catch {
    // Setup refuses an unsupported provider mix with its own error.
    return null;
  }
}
