import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  requireGitHubAppPrivateKey,
  resolveReviewRouterCodexRotatingActionRef,
  resolveReviewRouterActionRef,
} from "@reviewrouter/platform-config";
import {
  ManageProducerReleases,
  ManageReviewMutationAuthority,
  ManageReviewSafetyControls,
  ManageScmRepositoryIdentities,
  ResolveReviewSafetyPolicy,
  ReviewMutationAuthorityInitializationMode,
  ReviewMutationAuthorityProofCollector,
  ReviewMutationLaneKind,
  ReviewRunControlDomainError,
  ReviewRunControlErrorCode,
} from "@reviewrouter/features-review-run-control";
import {
  createPrismaReviewRunControlRepositories,
  createTrustedProducerReleaseMaterializer,
  trustedProducerReleaseMaterializationLimits,
  ConfiguredProducerReleaseAttestationRegistry,
  readConfiguredProducerReleaseAttestations,
} from "@reviewrouter/features-review-run-control/composition";
import {
  ProvisionGatewayReviewV2Repository,
  ProductionReviewMutationAuthorityProofFacts,
  createGatewayReviewV2ProducerReleaseAttestations,
  ManagedReviewV2WorkflowInventory,
  createOctokitReviewV2RepositoryScopedReadAccess,
  OctokitReviewV2DispatchCapabilityInspector,
  gatewayReviewV2AuthorityRecovery,
  gatewayReviewV2SafetyAllowed,
  gatewayReviewV2SafetyCapabilities,
  type GatewayReviewV2ProvisioningCommand,
  type GatewayReviewV2ProvisioningResult,
} from "@reviewrouter/features-workflow-provisioning";

function provisioningFailureCode(error: unknown): string {
  if (error instanceof ReviewRunControlDomainError) {
    const code = Object.values(ReviewRunControlErrorCode).find(
      (value) => value === error.code,
    );
    if (code) return code;
  }
  if (error instanceof Error) {
    const code = [
      "workflow_provisioning_match_not_found",
      "hosted_pool_binding_revision_conflict",
      "codex_rotating_workflow_inventory_coverage_moved",
      "codex_rotating_workflow_inventory_mergeability_unavailable",
      "review_v2_dispatch_token_invalid_response",
    ].find((value) => value === error.message);
    if (code) return code;
  }
  if (typeof error === "object" && error !== null) {
    if (
      "code" in error &&
      ["P2002", "P2010", "P2028"].some((value) => value === error.code)
    )
      return "database_error";
    if ("status" in error) {
      if ([403, 404, 422].some((value) => value === error.status))
        return "github_permission_unavailable";
      if (
        typeof error.status === "number" &&
        Number.isInteger(error.status) &&
        error.status >= 500 &&
        error.status <= 599
      )
        return "github_service_unavailable";
    }
  }
  return "unclassified_error";
}

export type GatewayReviewV2RepositoryReadiness =
  GatewayReviewV2ProvisioningResult;
export type {
  GatewayReviewV2ProvisioningCommand,
  GatewayReviewV2ProvisioningResult,
};
const digest = {
  async digestUtf8(value: string) {
    return createHash("sha256").update(value, "utf8").digest("hex");
  },
};
const clock = { now: () => new Date() };
const identifiers = { nextId: (prefix: string) => `${prefix}-${randomUUID()}` };

export async function provisionGatewayReviewV2Repository(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly command: GatewayReviewV2ProvisioningCommand;
  /** Bound to a canonical immutable native caller by setup verification. */
  readonly subscriptionAuthMode?: "claude-oauth";
  readonly assertCurrentSetupAndSource: () => Promise<void>;
}): Promise<GatewayReviewV2ProvisioningResult> {
  if (
    input.env.REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED !== "1" ||
    !input.env.GITHUB_APP_ID
  )
    return { status: "blocked", issue: "gateway_review_v2_runtime_not_ready" };
  if (!input.env.REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON)
    return {
      status: "blocked",
      issue: "gateway_review_v2_release_registry_missing",
    };
  try {
    const repositories = createPrismaReviewRunControlRepositories(input.prisma);
    const safety = new ResolveReviewSafetyPolicy({
      clock,
      digest,
      policyQueries: repositories.safetyControls,
      emergencyQueries: repositories.safetyControls,
    });
    const attestations = new ConfiguredProducerReleaseAttestationRegistry(
      readConfiguredProducerReleaseAttestations(input.env),
      repositories.producerReleases,
    );
    const github = {
      appId: input.env.GITHUB_APP_ID,
      privateKey: requireGitHubAppPrivateKey(input.env),
    };
    const inventory = new ManagedReviewV2WorkflowInventory({
      expectedApiUrl: input.command.expectedGatewaySource.apiUrl,
      access: createOctokitReviewV2RepositoryScopedReadAccess(github),
    });
    const dispatchCapability = new OctokitReviewV2DispatchCapabilityInspector(
      github,
    );
    const facts = new ProductionReviewMutationAuthorityProofFacts({
      prisma: input.prisma,
      identities: repositories.repositoryIdentities,
      authorities: repositories.mutationAuthorities,
      producerReleases: repositories.producerReleases,
      selectedProducerActionCommitSha: () => {
        try {
          return (
            (input.subscriptionAuthMode === "claude-oauth"
              ? resolveReviewRouterActionRef(input.env)
              : resolveReviewRouterCodexRotatingActionRef(input.env)
            ).split("@")[1] ?? null
          );
        } catch {
          return null;
        }
      },
      releaseAttestations: attestations,
      safety,
      workflowInventory: inventory,
      dispatchCapability,
      completionWorkerConfigured:
        input.env.REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED === "1",
      directV2InitializationEnabled:
        input.env.REVIEW_ROUTER_REVIEW_V2_DIRECT_INITIALIZATION_ENABLED === "1",
      now: clock.now,
      actionRepositories: {
        async findSelectedRepositoryByGithubId(githubRepositoryId) {
          const repository = await input.prisma.repositoryConnection.findFirst({
            where: {
              githubRepositoryId: BigInt(githubRepositoryId),
              provider: "github",
              workspaceId: input.command.workspaceId,
              id: input.command.repositoryId,
              installationId: input.command.installationId,
              selected: true,
              archived: false,
              installation: { status: "active" },
            },
            include: { installation: true },
          });
          return repository?.installation &&
            repository.githubRepositoryId !== null
            ? {
                workspaceId: repository.workspaceId,
                repositoryId: repository.id,
                githubRepositoryId: repository.githubRepositoryId.toString(),
                githubInstallationId:
                  repository.installation.githubInstallationId.toString(),
                fullName: repository.fullName,
                owner: repository.owner,
                selected: repository.selected,
                installationStatus: repository.installation.status,
              }
            : null;
        },
      },
    });
    const producerReleases = new ManageProducerReleases({
      clock,
      digest,
      protocolLimitsQueries: repositories.producerReleases,
      protocolLimitsCommands: repositories.producerReleases,
      operationalSloQueries: repositories.producerReleases,
      operationalSloCommands: repositories.producerReleases,
      releaseQueries: repositories.producerReleases,
      releaseCommands: repositories.producerReleases,
      absoluteProtocolMaxima: trustedProducerReleaseMaterializationLimits,
    });
    const operation = new ProvisionGatewayReviewV2Repository({
      clock,
      digest,
      identities: new ManageScmRepositoryIdentities({
        clock,
        identifiers,
        identityQueries: repositories.repositoryIdentities,
        identityCommands: repositories.repositoryIdentities,
        authorityQueries: repositories.mutationAuthorities,
      }),
      identityQueries: repositories.repositoryIdentities,
      authorityQueries: repositories.mutationAuthorities,
      mutationAuthority: new ManageReviewMutationAuthority({
        clock,
        queries: repositories.mutationAuthorities,
        commands: repositories.mutationAuthorities,
        proofs: new ReviewMutationAuthorityProofCollector({ digest, facts }),
        initializationPolicy: {
          async selectInitializationMode() {
            return ReviewMutationAuthorityInitializationMode.V1;
          },
        },
      }),
      safetyControls: new ManageReviewSafetyControls({
        clock,
        identifiers,
        inspections: repositories.safetyControls,
        policyCommands: repositories.safetyControls,
        emergencyCommands: repositories.safetyControls,
      }),
      safetyQueries: repositories.safetyControls,
      safety,
      attestations:
        createGatewayReviewV2ProducerReleaseAttestations(attestations),
      workflowInventory: inventory,
      dispatchCapability,
      materializer: createTrustedProducerReleaseMaterializer({
        digest,
        producerReleases,
        releaseQueries: repositories.producerReleases,
        protocolLimitsQueries: repositories.producerReleases,
        operationalSloQueries: repositories.producerReleases,
      }),
      assertCurrentSetupAndSource: input.assertCurrentSetupAndSource,
    });
    return await operation.execute(input.command);
  } catch (error) {
    console.warn("gateway_review_v2_provisioning_failed", {
      code: provisioningFailureCode(error),
    });
    const inventoryRetry =
      error instanceof Error &&
      [
        "codex_rotating_workflow_inventory_coverage_moved",
        "codex_rotating_workflow_inventory_mergeability_unavailable",
      ].includes(error.message);
    return {
      status: "blocked",
      issue: inventoryRetry
        ? "gateway_review_v2_inventory_retry"
        : "gateway_review_v2_provisioning_failed",
    };
  }
}

/** Display reads cannot initialize authority or enroll policy. */
export async function readGatewayReviewV2RepositoryReadiness(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly repositoryIds: readonly string[];
}): Promise<ReadonlyMap<string, GatewayReviewV2RepositoryReadiness>> {
  if (input.repositoryIds.length === 0) return new Map();
  const [identities, eligible] = await Promise.all([
    input.prisma.scmRepositoryIdentity.findMany({
      where: {
        provider: "github",
        currentWorkspaceId: input.workspaceId,
        currentRepositoryConnectionId: { in: [...input.repositoryIds] },
      },
    }),
    input.prisma.repositoryConnection.findMany({
      where: {
        id: { in: [...input.repositoryIds] },
        workspaceId: input.workspaceId,
        provider: "github",
        selected: true,
        archived: false,
        installation: { status: "active" },
      },
      select: { id: true },
    }),
  ]);
  const authorities = await input.prisma.reviewMutationAuthority.findMany({
    where: {
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
      scmRepositoryIdentityId: {
        in: identities.map((identity) => identity.scmRepositoryIdentityId),
      },
    },
  });
  const eligibleIds = new Set(eligible.map((repository) => repository.id));
  const identitiesByRepository = new Map(
    identities.map((identity) => [
      identity.currentRepositoryConnectionId!,
      identity,
    ]),
  );
  const authoritiesByIdentity = new Map(
    authorities.map((authority) => [
      authority.scmRepositoryIdentityId,
      authority,
    ]),
  );
  const repositories = createPrismaReviewRunControlRepositories(input.prisma);
  const entries = await Promise.all(
    input.repositoryIds.map(
      async (
        repositoryId,
      ): Promise<readonly [string, GatewayReviewV2RepositoryReadiness]> => {
        const identity = identitiesByRepository.get(repositoryId);
        if (!identity || !eligibleIds.has(repositoryId))
          return [
            repositoryId,
            {
              status: "conflict",
              issue: "gateway_repository_identity_missing",
            },
          ];
        const authority =
          authoritiesByIdentity.get(identity.scmRepositoryIdentityId) ?? null;
        const recovery = gatewayReviewV2AuthorityRecovery(authority);
        if (recovery) return [repositoryId, recovery];
        const target = {
          workspaceId: input.workspaceId,
          repositoryConnectionId: repositoryId,
          scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
        };
        const policies =
          repositories.safetyControls.findApplicableReviewSafetyPolicies({
            target,
            capabilities: gatewayReviewV2SafetyCapabilities,
          });
        const controls =
          repositories.safetyControls.findApplicableReviewSafetyEmergencyControls(
            target,
          );
        const safety = new ResolveReviewSafetyPolicy({
          clock,
          digest,
          policyQueries: {
            async findApplicableReviewSafetyPolicies({ capabilities }) {
              return (await policies).filter((policy) =>
                capabilities.includes(policy.capability),
              );
            },
          },
          emergencyQueries: {
            async findApplicableReviewSafetyEmergencyControls() {
              return controls;
            },
          },
        });
        if (!(await gatewayReviewV2SafetyAllowed(safety, target)))
          return [
            repositoryId,
            { status: "blocked", issue: "gateway_review_v2_safety_blocked" },
          ];
        return [
          repositoryId,
          {
            status: "ready",
            outcome: "restored",
            scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
            authorityVersion: authority!.version,
            authorityEpoch: authority!.epoch.toString(),
            actionCommitSha: null,
          },
        ];
      },
    ),
  );
  return new Map(entries);
}

export function isGatewayReviewV2RepositoryReady(
  readiness: GatewayReviewV2RepositoryReadiness | undefined,
): boolean {
  return readiness?.status === "ready";
}
