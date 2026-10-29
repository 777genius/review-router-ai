import { NextResponse, type NextRequest } from "next/server";
import {
  evaluateFeatureEntitlement,
  freeBetaEntitlement,
  PrismaEntitlementRepository,
} from "@reviewrouter/features-entitlements";
import { PrismaHostedPoolQuery } from "@reviewrouter/features-hosted-account-pool";
import {
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfigurations,
} from "@reviewrouter/features-review-config";
import {
  listWorkspaceRepositoryHealth,
  PrismaRepositoryHealthRepository,
} from "@reviewrouter/features-repo-health";
import { projectRepositorySetupStatus } from "@reviewrouter/features-workflow-provisioning";
import {
  isHostedCodexPoolEnabled,
  requireReviewRouterDatabaseRecoveryWitness,
  resolveReviewRouterActionRef,
} from "@reviewrouter/platform-config";
import { isSetupRecoveryIssue } from "../../../../dashboard/dashboard-copy";
import {
  asDashboardGitHubActor,
  getDashboardSignedInActor,
  getDashboardWorkspaceScope,
} from "../../../../../src/server/dashboard-mutations";
import { deriveDashboardProviderSetupReadiness } from "../../../../../src/server/dashboard-codex-rotating-setup-readiness";
import {
  loadDashboardGatewayAccounts,
  hydrateDashboardGatewayAccounts,
  loadDashboardPersonalAccounts,
} from "../../../../../src/server/dashboard-gateway-accounts";
import {
  dashboardRepositoryConfigs,
  gatewayReviewRepositoryIds,
  resolveDashboardRepositoryReadiness,
} from "../../../../../src/server/dashboard-repository-readiness";
import { listGitHubUserRepositoryAccess } from "../../../../../src/server/github-user-repository-access";
import { loadHostedPoolDashboardView } from "../../../../../src/server/hosted-pool-dashboard";
import { getPrisma } from "../../../../../src/server/prisma";
import { PrismaCodexRotatingSetupReadiness } from "../../../../../src/server/prisma-codex-rotating-setup-readiness";
import { readGatewayReviewV2RepositoryReadiness } from "../../../../../src/server/prisma-gateway-review-v2-provisioning";
import {
  buildRepositorySearchText,
  repositoryMatchesSearchFilter,
  tokenizeRepositorySearch,
  type RepositorySearchFilter,
} from "../../../../../src/server/repository-search";

export const dynamic = "force-dynamic";

type WorkspaceCandidate = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly installations: readonly { readonly accountLogin: string }[];
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const scope = await getDashboardWorkspaceScope();
  if (scope.kind === "none") {
    return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  }

  const workspaceKey = normalizeKey(
    request.nextUrl.searchParams.get("workspace") ?? "",
  );
  const query = normalizeQuery(request.nextUrl.searchParams.get("q") ?? "");
  const filter = readRepositorySearchFilter(request.nextUrl.searchParams);
  const prisma = getPrisma();
  const signedInActor = await getDashboardSignedInActor();
  const signedInGitHubActor = asDashboardGitHubActor(signedInActor);
  const fullAccessWorkspaceIds =
    scope.kind === "workspace_ids" ? scope.workspaceIds : [];
  const repositoryAccess =
    signedInGitHubActor && scope.kind !== "all"
      ? await listGitHubUserRepositoryAccess({
          prisma,
          actor: signedInGitHubActor,
          excludedWorkspaceIds: fullAccessWorkspaceIds,
        })
      : {
          status: "ready" as const,
          workspaceIds: [],
          repositoryIds: new Set<string>(),
          directConfigRepositoryIds: new Set<string>(),
          checkedAt: null,
        };
  const visibleWorkspaceIds = mergeWorkspaceIds(
    fullAccessWorkspaceIds,
    repositoryAccess.workspaceIds,
  );
  const workspaceWhere =
    scope.kind === "workspace_ids"
      ? { id: { in: visibleWorkspaceIds } }
      : undefined;
  const candidates = await prisma.workspace.findMany({
    ...(workspaceWhere ? { where: workspaceWhere } : {}),
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      slug: true,
      name: true,
      installations: {
        select: { accountLogin: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
    },
  });
  const workspace = selectWorkspace(candidates, workspaceKey);
  if (!workspace) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }
  const hasWorkspaceWideAccess =
    scope.kind === "all" ||
    (scope.kind === "workspace_ids" &&
      scope.workspaceIds.includes(workspace.id));

  const repositories = await prisma.repositoryConnection.findMany({
    where: {
      workspaceId: workspace.id,
      ...(hasWorkspaceWideAccess
        ? {}
        : { id: { in: [...repositoryAccess.repositoryIds] } }),
    },
    orderBy: [{ selected: "desc" }, { fullName: "asc" }],
    select: {
      id: true,
      githubRepositoryId: true,
      fullName: true,
      owner: true,
      name: true,
      provider: true,
      defaultBranch: true,
      visibility: true,
      setupStatus: true,
      provisioning: {
        where: { workspaceId: workspace.id },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          status: true,
          errorMessage: true,
          installedWorkflowRequirement: true,
        },
      },
      selected: true,
      archived: true,
      stargazersCount: true,
    },
  });
  const tokens = tokenizeRepositorySearch(query);
  // Readiness decides the setup filters and its health status is searchable
  // text; a plain repository list needs neither, nor the hosted pool and
  // Gateway reads behind them.
  if (filter === "all" && tokens.length === 0)
    return repositorySearchResponse({
      matching: repositories,
      total: repositories.length,
      query,
      filter,
    });
  const repositoryIds = repositories.map((repository) => repository.id);
  const [health, cachedProviderSetup, policies, storedEntitlement] =
    await Promise.all([
      listWorkspaceRepositoryHealth(
        {
          workspaceId: workspace.id,
          expectedActionRef: resolveReviewRouterActionRef(),
          workflowProbeMaxRepositories: 0,
        },
        { repositories: new PrismaRepositoryHealthRepository(prisma) },
      ),
      prisma.providerSetupState.findMany({
        where: {
          workspaceId: workspace.id,
          repositoryId: { in: repositoryIds },
        },
        select: {
          repositoryId: true,
          providerKind: true,
          authMode: true,
          state: true,
          updatedAt: true,
        },
      }),
      resolveEffectiveReviewConfigurations(
        { workspaceId: workspace.id, repositoryIds },
        { policyHeads: new PrismaReviewPolicyHeadReader(prisma) },
      ),
      new PrismaEntitlementRepository(prisma).findWorkspaceEntitlement(
        workspace.id,
      ),
    ]);
  const configs = dashboardRepositoryConfigs(policies.repositories);
  const gatewayRepositoryIds = gatewayReviewRepositoryIds({
    ...configs,
    repositoryIds,
  });
  const [providerSetup, hostedPool, gatewayAccounts, gatewayReadiness] =
    await Promise.all([
      deriveDashboardProviderSetupReadiness({
        providerSetup: cachedProviderSetup,
        repositories,
        workspaceId: workspace.id,
        readiness: new PrismaCodexRotatingSetupReadiness(
          prisma,
          requireReviewRouterDatabaseRecoveryWitness(),
        ),
      }),
      loadHostedPoolDashboardView({
        workspaceId: workspace.id,
        repositories: repositories.map((repository) => ({
          id: repository.id,
          fullName: repository.fullName,
          visibility: repository.visibility,
        })),
        featureEnabled: isHostedCodexPoolEnabled(),
        entitled: evaluateFeatureEntitlement({
          entitlement: storedEntitlement ?? freeBetaEntitlement(workspace.id),
          feature: "hosted_codex_pool",
        }).allowed,
        queries: new PrismaHostedPoolQuery(prisma),
      }),
      // Listing accounts calls the Gateway, so only Gateway policies pay for it.
      gatewayRepositoryIds.length > 0
        ? loadDashboardPersonalAccounts(workspace.id).then((personal) =>
            loadDashboardGatewayAccounts(workspace.id, personal).then(
              (accounts) =>
                hydrateDashboardGatewayAccounts(
                  workspace.id,
                  personal,
                  accounts,
                  [...configs.effectiveConfigs.values()].flatMap(
                    (config) =>
                      config?.providers.flatMap((provider) =>
                        provider.authMode === "codex_account_gateway"
                          ? [provider.gatewayBindingId]
                          : [],
                      ) ?? [],
                  ),
                ),
            ),
          )
        : undefined,
      readGatewayReviewV2RepositoryReadiness({
        prisma,
        workspaceId: workspace.id,
        repositoryIds: gatewayRepositoryIds,
      }),
    ]);
  const repositoryReadiness = resolveDashboardRepositoryReadiness({
    ...configs,
    repositories: repositories.map((repository) => ({
      ...repository,
      setupStatus: projectRepositorySetupStatus({
        workflowProvisioningStatus: repository.provisioning[0]?.status ?? null,
        legacySetupStatus: repository.setupStatus,
      }),
      setupNeedsAttention: isSetupRecoveryIssue(
        repository.provisioning[0]?.errorMessage ?? null,
      ),
      installedWorkflowRequirement:
        repository.provisioning[0]?.installedWorkflowRequirement ?? null,
    })),
    health,
    providerSetup,
    hostedRepositories: hostedPool.repositories,
    gatewayAccounts,
    gatewayReadiness,
    providerSecretCheckFailedRepositoryFullName: null,
  });
  const repositoryHealthById = new Map(
    health.map((item) => [item.repositoryId, item] as const),
  );

  const matchingRepositories = repositoryReadiness
    .filter(({ repository, healthStatus, readiness }) => {
      if (!repositoryMatchesSearchFilter({ repository, readiness }, filter)) {
        return false;
      }
      if (tokens.length === 0) return true;
      const searchable = buildRepositorySearchText({
        fullName: repository.fullName,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        visibility: repository.visibility,
        stargazersCount: repository.stargazersCount,
        archived: repository.archived,
        selected: repository.selected,
        setupStatus: repository.setupStatus,
        healthStatus,
        healthSummary: repositoryHealthById.get(repository.id)?.summary,
      });
      return tokens.every((token) => searchable.includes(token));
    })
    .map(({ repository }) => repository);

  return repositorySearchResponse({
    matching: matchingRepositories,
    total: repositories.length,
    query,
    filter,
  });
}

function repositorySearchResponse(input: {
  readonly matching: readonly {
    readonly id: string;
    readonly fullName: string;
    readonly provider: string;
  }[];
  readonly total: number;
  readonly query: string;
  readonly filter: RepositorySearchFilter;
}): NextResponse {
  return NextResponse.json({
    repositoryIds: input.matching.map((repository) => repository.id),
    repositories: input.matching.map((repository) => ({
      id: repository.id,
      fullName: repository.fullName,
      provider: repository.provider,
    })),
    total: input.total,
    query: input.query,
    filter: input.filter,
  });
}

function readRepositorySearchFilter(
  params: URLSearchParams,
): RepositorySearchFilter {
  const setup = params.get("setup");
  if (setup === "needed") return "needs_setup";
  if (setup === "attention") return "needs_attention";
  if (setup === "ready") return "ready";

  const visibility = params.get("visibility");
  if (visibility === "private" || visibility === "public") {
    return visibility;
  }

  return "all";
}

function selectWorkspace(
  candidates: readonly WorkspaceCandidate[],
  workspaceKey: string,
): WorkspaceCandidate | null {
  if (candidates.length === 0) return null;
  if (!workspaceKey) return candidates[0] ?? null;
  return (
    candidates.find((workspace) =>
      workspaceKeys(workspace).includes(workspaceKey),
    ) ?? null
  );
}

function workspaceKeys(workspace: WorkspaceCandidate): string[] {
  return [
    workspace.id,
    workspace.slug,
    workspace.name,
    ...workspace.installations.map((installation) => installation.accountLogin),
  ]
    .filter(Boolean)
    .map(normalizeKey);
}

function mergeWorkspaceIds(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return [...new Set([...left, ...right])];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeQuery(value: string): string {
  return value.trim().slice(0, 120);
}
