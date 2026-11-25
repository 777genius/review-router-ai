import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  ManageReviewMutationAuthority,
  ReviewMutationAuthorityInitializationMode,
  ReviewMutationAuthorityProofCollector,
  ReviewMutationLaneKind,
  ReviewMutationMode,
  ReviewSafetyPolicyScope,
  ReviewSafetyRolloutMode,
  ReviewSafetyCapability,
  ReviewRunAuthorizationUseCaseStatus,
  ReviewProviderKind,
  ReviewTrustDomain,
  ScmProvider,
} from "@reviewrouter/features-review-run-control";
import {
  ConfiguredProducerReleaseAttestationRegistry,
  createTrustedProducerReleaseMaterializer,
} from "@reviewrouter/features-review-run-control/composition";
import { createReviewRunControlTestKit } from "@reviewrouter/features-review-run-control/testing";
import { releaseCandidate } from "../../../review-run-control/src/tests/fixtures";
import {
  reviewActionV2CanonicalizerDigest,
  reviewActionV2PublishedSchemaDigest,
} from "@reviewrouter/protocol-review-action-v2";
import { renderAccountGatewayWorkflow } from "../domain/workflow-template";
import { ManagedReviewV2WorkflowInventory } from "../infrastructure/github/managed-review-v2-workflow-inventory";
import {
  ProductionReviewMutationAuthorityProofFacts,
  createGatewayReviewV2ProducerReleaseAttestations,
} from "../infrastructure/review-v2-mutation-proof-facts";
import {
  ProvisionGatewayReviewV2Repository,
  gatewayReviewV2SafetyCapabilities,
  type GatewayReviewV2ProvisioningCommand,
} from "../application/provision-gateway-review-v2-repository";

const sha = releaseCandidate.actionCommitSha;
const head = "b".repeat(40);
const command: GatewayReviewV2ProvisioningCommand = {
  workspaceId: "workspace-1",
  repositoryId: "repository-1",
  installationId: "installation-1",
  actor: "fixture-operator",
  expectedAttempt: null,
  repository: {
    githubRepositoryId: "123456",
    githubInstallationId: "42",
    fullName: "owner/repo",
    owner: "owner",
  },
  expectedGatewaySource: {
    actionRef: `777genius/review-router@${sha}`,
    actionCommitSha: sha,
    apiUrl: "https://reviewrouter.example",
    sourceRevision: head,
  },
};

async function fixture(
  raceLegacy = false,
  dispatchAvailable = true,
  inspectedHead = head,
) {
  const kit = createReviewRunControlTestKit();
  for (const capability of gatewayReviewV2SafetyCapabilities)
    await kit.control.safetyControls.updateReviewSafetyPolicy({
      expectedVersion: 0,
      scope: { scope: ReviewSafetyPolicyScope.Global },
      capability,
      rolloutMode: ReviewSafetyRolloutMode.Allowlisted,
      updatedBy: command.actor,
    });
  await kit.control.safetyControls.setReviewSafetyEmergencyStop({
    expectedVersion: 0,
    scope: { scope: ReviewSafetyPolicyScope.Global },
    stopped: false,
    reason: "fixture-ready",
    updatedBy: command.actor,
  });
  const workflow = renderAccountGatewayWorkflow({
    actionRef: command.expectedGatewaySource.actionRef,
    apiUrl: command.expectedGatewaySource.apiUrl,
    githubRepositoryId: command.repository.githubRepositoryId,
  });
  const inventory = new ManagedReviewV2WorkflowInventory({
    expectedApiUrl: command.expectedGatewaySource.apiUrl,
    access: {
      issueRepositoryReadToken: async () => ({
        token: "fixture-only",
        expiresAt: new Date("2099-01-01"),
      }),
      async request(route, parameters) {
        if (route === "GET /repos/{owner}/{repo}")
          return {
            data: {
              id: 123456,
              full_name: "owner/repo",
              default_branch: "main",
            },
          };
        if (route === "GET /repos/{owner}/{repo}/pulls") return { data: [] };
        if (route === "GET /repos/{owner}/{repo}/branches/{branch}")
          return { data: { name: "main", commit: { sha: inspectedHead } } };
        if (
          route === "GET /repos/{owner}/{repo}/contents/{path}" &&
          parameters.path === workflow.path
        )
          return {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(workflow.content).toString("base64"),
            },
          };
        throw Object.assign(new Error("fixture-workflow-absent"), {
          status: 404,
        });
      },
    },
  });
  const attestations = new ConfiguredProducerReleaseAttestationRegistry(
    [
      {
        ...releaseCandidate,
        schemaDigest: reviewActionV2PublishedSchemaDigest,
        wrapperEntrypointDigest: null,
        canonicalizerDigest: reviewActionV2CanonicalizerDigest,
        contextGatewayPolicyVersion: null,
        contextGatewayEntrypointDigest: null,
      },
    ],
    kit.store,
  );
  const dispatchCapability = {
    inspectReviewV2DispatchCapability: async () => ({
      available: dispatchAvailable,
    }),
  };
  const facts = new ProductionReviewMutationAuthorityProofFacts({
    prisma: {
      reviewRunAuthorization: { count: async () => 0 },
    } as unknown as PrismaClient,
    identities: kit.store,
    authorities: kit.store,
    releaseAttestations: attestations,
    producerReleases: kit.store,
    selectedProducerActionCommitSha: () => sha,
    safety: kit.control.safetyResolver,
    workflowInventory: inventory,
    dispatchCapability,
    completionWorkerConfigured: true,
    directV2InitializationEnabled: true,
    now: () => kit.clock.now(),
    actionRepositories: {
      async findSelectedRepositoryByGithubId() {
        return {
          workspaceId: command.workspaceId,
          repositoryId: command.repositoryId,
          githubRepositoryId: command.repository.githubRepositoryId,
          githubInstallationId: command.repository.githubInstallationId,
          fullName: command.repository.fullName,
          owner: command.repository.owner,
          selected: true,
          installationStatus: "active",
        };
      },
    },
  });
  const mutationAuthority = new ManageReviewMutationAuthority({
    clock: kit.clock,
    queries: kit.store,
    commands: {
      compareAndSetReviewMutationAuthority: (input) =>
        kit.store.compareAndSetReviewMutationAuthority(input),
      async initializeReviewMutationAuthority(authority) {
        if (raceLegacy) {
          await kit.control.mutationAuthority.initializeV1({
            scmRepositoryIdentityId: authority.scmRepositoryIdentityId,
          });
          raceLegacy = false;
        }
        return kit.store.initializeReviewMutationAuthority(authority);
      },
    },
    proofs: new ReviewMutationAuthorityProofCollector({
      digest: kit.digest,
      facts,
    }),
    initializationPolicy: {
      async selectInitializationMode() {
        return ReviewMutationAuthorityInitializationMode.V1;
      },
    },
  });
  const operation = new ProvisionGatewayReviewV2Repository({
    clock: kit.clock,
    digest: kit.digest,
    identities: kit.control.repositoryIdentities,
    identityQueries: kit.store,
    authorityQueries: kit.store,
    mutationAuthority,
    safetyControls: kit.control.safetyControls,
    safetyQueries: kit.store,
    safety: kit.control.safetyResolver,
    attestations:
      createGatewayReviewV2ProducerReleaseAttestations(attestations),
    workflowInventory: inventory,
    dispatchCapability,
    assertCurrentSetupAndSource: async () => undefined,
    materializer: createTrustedProducerReleaseMaterializer({
      digest: kit.digest,
      producerReleases: kit.control.producerReleases,
      releaseQueries: kit.store,
      protocolLimitsQueries: kit.store,
      operationalSloQueries: kit.store,
    }),
  });
  return { kit, operation };
}

describe("normal fresh Gateway provisioning", () => {
  it("rejects inventory from another default-branch revision before materializing admission authority", async () => {
    const { kit, operation } = await fixture(false, true, "c".repeat(40));

    expect(await operation.execute(command)).toMatchObject({
      status: "blocked",
      issue: "gateway_review_v2_workflow_incompatible",
    });
    const identity =
      await kit.store.findScmRepositoryIdentityByExternalIdentity({
        provider: ScmProvider.GitHub,
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: command.repository.githubRepositoryId,
      });
    expect(
      await kit.store.findReviewMutationAuthority({
        scmRepositoryIdentityId: identity!.scmRepositoryIdentityId,
        laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
      }),
    ).toBeNull();
    expect(
      await kit.store.findProducerReleaseById(
        releaseCandidate.producerReleaseId,
      ),
    ).toBeNull();
    expect(
      await kit.store.findReviewSafetyPolicy({
        scope: {
          scope: ReviewSafetyPolicyScope.Repository,
          workspaceId: command.workspaceId,
          repositoryConnectionId: command.repositoryId,
          scmRepositoryIdentityId: identity!.scmRepositoryIdentityId,
        },
        capability: ReviewSafetyCapability.RunAuthorizationV2,
      }),
    ).toBeNull();
  });
  it("blocks dispatch-only Gateway provisioning without actual App dispatch permission", async () => {
    const { kit, operation } = await fixture(false, false);
    expect(await operation.execute(command)).toMatchObject({
      status: "blocked",
      issue: "gateway_review_v2_dispatch_unavailable",
    });
    const identity =
      await kit.store.findScmRepositoryIdentityByExternalIdentity({
        provider: ScmProvider.GitHub,
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: command.repository.githubRepositoryId,
      });
    expect(
      await kit.store.findReviewMutationAuthority({
        scmRepositoryIdentityId: identity!.scmRepositoryIdentityId,
        laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
      }),
    ).toBeNull();
  });
  it("creates real proof-backed epoch and scoped enrollment, restores, then permits domain authorization", async () => {
    const { kit, operation } = await fixture();
    const global = await Promise.all(
      gatewayReviewV2SafetyCapabilities.map((capability) =>
        kit.store.findReviewSafetyPolicy({
          scope: { scope: ReviewSafetyPolicyScope.Global },
          capability,
        }),
      ),
    );
    const emergency = await kit.store.findReviewSafetyEmergencyControl({
      scope: ReviewSafetyPolicyScope.Global,
    });
    const result = await operation.execute(command);
    expect(result, JSON.stringify(result)).toMatchObject({
      status: "ready",
      outcome: "created",
      authorityEpoch: "1",
    });
    if (result.status !== "ready") throw new Error("fixture-not-ready");
    const authority = await kit.store.findReviewMutationAuthority({
      scmRepositoryIdentityId: result.scmRepositoryIdentityId,
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });
    expect(authority).toMatchObject({
      mode: ReviewMutationMode.V2Active,
      epoch: 1n,
      version: 1,
    });
    expect(authority?.managedWorkflowInventoryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(authority?.activationSafetyDecisionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await operation.execute(command)).toMatchObject({
      status: "ready",
      outcome: "restored",
      authorityVersion: 1,
    });
    expect(
      await Promise.all(
        gatewayReviewV2SafetyCapabilities.map((capability) =>
          kit.store.findReviewSafetyPolicy({
            scope: { scope: ReviewSafetyPolicyScope.Global },
            capability,
          }),
        ),
      ),
    ).toEqual(global);
    expect(
      await kit.store.findReviewSafetyEmergencyControl({
        scope: ReviewSafetyPolicyScope.Global,
      }),
    ).toEqual(emergency);
    const authorization = await kit.control.authorizations.authorizeReviewRun({
      verifiedIdentity: {
        workspaceId: command.workspaceId,
        repositoryConnectionId: command.repositoryId,
        scmRepositoryIdentityId: result.scmRepositoryIdentityId,
        pullRequestNumber: 1,
        sourceRunId: "run-1",
        sourceRunAttempt: "1",
        workflowIdentityHash: "a".repeat(64),
        baseSha: sha,
        mergeBaseSha: head,
        headSha: "c".repeat(40),
        reviewRevisionHash: "b".repeat(64),
        trustDomain: ReviewTrustDomain.TrustedManaged,
      },
      producerReleaseId: releaseCandidate.producerReleaseId,
      protocolOfferHash: "a".repeat(64),
      oidcReplayKeyHash: "b".repeat(64),
      providerVoteLanes: [
        {
          providerKind: ReviewProviderKind.Codex,
          providerVoteIdentityHash: "c".repeat(64),
        },
      ],
      authorizationTtlMs: 600000,
      maxAuthorizationLifetimeMs: 3600000,
    });
    expect(authorization.status).toBe(
      ReviewRunAuthorizationUseCaseStatus.Authorized,
    );
  });

  it("preserves a concurrent legacy CAS winner and never reports ready", async () => {
    const { kit, operation } = await fixture(true);
    const result = await operation.execute(command);
    expect(result.status).toBe("legacy_migration_required");
    const identity =
      await kit.store.findScmRepositoryIdentityByExternalIdentity({
        provider: ScmProvider.GitHub,
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: command.repository.githubRepositoryId,
      });
    const authority = await kit.store.findReviewMutationAuthority({
      scmRepositoryIdentityId: identity!.scmRepositoryIdentityId,
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });
    expect(authority).toMatchObject({
      mode: ReviewMutationMode.V1Open,
      epoch: 0n,
      version: 1,
    });
  });

  it("preserves explicit repository denial and global emergency stop without creating authority", async () => {
    for (const denial of ["repository", "emergency"] as const) {
      const { kit, operation } = await fixture();
      const { identity } =
        await kit.control.repositoryIdentities.resolveOrRegisterScmRepositoryIdentity(
          {
            provider: ScmProvider.GitHub,
            sourceBaseUrl: "https://github.com",
            externalRepositoryId: command.repository.githubRepositoryId,
          },
        );
      await kit.control.repositoryIdentities.bindScmRepositoryIdentity({
        scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
        expectedVersion: identity.version,
        workspaceId: command.workspaceId,
        repositoryConnectionId: command.repositoryId,
      });
      if (denial === "repository")
        await kit.control.safetyControls.updateReviewSafetyPolicy({
          expectedVersion: 0,
          scope: {
            scope: ReviewSafetyPolicyScope.Repository,
            workspaceId: command.workspaceId,
            repositoryConnectionId: command.repositoryId,
            scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
          },
          capability: ReviewSafetyCapability.EvidenceWritesV2,
          rolloutMode: ReviewSafetyRolloutMode.Disabled,
          updatedBy: command.actor,
        });
      else
        await kit.control.safetyControls.setReviewSafetyEmergencyStop({
          expectedVersion: 1,
          scope: { scope: ReviewSafetyPolicyScope.Global },
          stopped: true,
          reason: "fixture-stop",
          updatedBy: command.actor,
        });
      expect(await operation.execute(command)).toMatchObject({
        status: "blocked",
        issue: "gateway_review_v2_safety_blocked",
      });
      expect(
        await kit.store.findReviewMutationAuthority({
          scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
          laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
        }),
      ).toBeNull();
      expect(
        await kit.store.findReviewSafetyPolicy({
          scope: {
            scope: ReviewSafetyPolicyScope.Repository,
            workspaceId: command.workspaceId,
            repositoryConnectionId: command.repositoryId,
            scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
          },
          capability: ReviewSafetyCapability.RunAuthorizationV2,
        }),
      ).toBeNull();
    }
  });
});
