import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { CodexRotatingT0WorkflowSchemaVersion } from "@reviewrouter/features-codex-oauth-rotating";
import {
  ProducerDistributionKind,
  ProducerReleaseAttestationStatus,
  ProducerReleaseState,
  ReviewCapabilityProfile,
  ReviewMutationLaneKind,
  ReviewMutationMode,
  ReviewSafetyDecisionKind,
  ScmProvider,
  type ReviewMutationAuthority,
  type ProducerRelease,
  type ScmRepositoryIdentity,
} from "@reviewrouter/features-review-run-control";
import { ProductionReviewMutationAuthorityProofFacts } from "./review-action-v2-mutation-proof-facts";

const now = new Date("2026-07-22T12:00:00.000Z");

describe("ProductionReviewMutationAuthorityProofFacts", () => {
  it("proves activation only after drain, compatible inventory and enabled safety", async () => {
    const facts = await createFacts().inspectActivationFacts({
      scmRepositoryIdentityId: "identity-1",
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });

    expect(facts.factsVersion).toBe(
      "review-mutation-authority-production-facts-v3",
    );
    expect(facts.facts).toEqual({
      noTrackedLegacyActivity: true,
      workflowInventoryCompatible: true,
      registeredReleaseSelected: true,
      completionWorkerConfigured: true,
      dispatchCapabilityAvailable: true,
      managedWorkflowInventoryHash: "a".repeat(64),
      safetyDecisionEnabled: true,
      activationSafetyDecisionHash: "b".repeat(64),
    });
  });

  it("fails closed while the drain window has not elapsed", async () => {
    const facts = await createFacts({
      drainNotBefore: new Date(now.getTime() + 1),
    }).inspectActivationFacts({
      scmRepositoryIdentityId: "identity-1",
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });

    expect(facts.facts.noTrackedLegacyActivity).toBe(false);
  });

  it("rejects activation without dispatch for a dispatch-only workflow", async () => {
    const facts = await createFacts({
      dispatchCapabilityAvailable: false,
      workflowSchemaVersion:
        CodexRotatingT0WorkflowSchemaVersion.DurableDispatchV1,
    }).inspectActivationFacts({
      scmRepositoryIdentityId: "identity-1",
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });

    expect(facts.facts.dispatchCapabilityAvailable).toBe(false);
  });

  it("denies activation without managed dispatch even with canonical source", async () => {
    const facts = await createFacts({
      dispatchCapabilityAvailable: false,
    }).inspectActivationFacts({
      scmRepositoryIdentityId: "identity-1",
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });

    expect(facts.facts).toMatchObject({
      noTrackedLegacyActivity: true,
      workflowInventoryCompatible: true,
      registeredReleaseSelected: true,
      dispatchCapabilityAvailable: false,
    });
  });

  it("does not substitute an incompatible client-triggered inventory for dispatch", async () => {
    const facts = await createFacts({
      dispatchCapabilityAvailable: false,
      inventoryCompatible: false,
    }).inspectActivationFacts({
      scmRepositoryIdentityId: "identity-1",
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });

    expect(facts.facts.workflowInventoryCompatible).toBe(false);
    expect(facts.facts.dispatchCapabilityAvailable).toBe(false);
  });

  it("keeps direct V2 execution authority absent without managed dispatch", async () => {
    const facts = await createFacts({
      authorityMissing: true,
      directV2InitializationEnabled: true,
      dispatchCapabilityAvailable: false,
    }).inspectDirectV2InitializationFacts({
      scmRepositoryIdentityId: "identity-1",
    });

    expect(facts.factsVersion).toBe(
      "review-mutation-authority-production-facts-v4",
    );
    expect(facts.facts).toMatchObject({
      freshV2OnlyProvisioningProven: true,
      noLegacyCapabilityEverIssued: true,
      workflowInventoryCompatible: true,
      registeredReleaseSelected: true,
      completionWorkerConfigured: true,
      executionAuthorityMode: null,
    });
  });

  it("does not restore client-triggered authority for an old schema", async () => {
    const facts = await createFacts({
      authorityMissing: true,
      directV2InitializationEnabled: true,
      dispatchCapabilityAvailable: false,
      workflowSchemaVersion:
        CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3,
    }).inspectDirectV2InitializationFacts({
      scmRepositoryIdentityId: "identity-1",
    });

    expect(facts.facts.executionAuthorityMode).toBeNull();
  });

  it("rejects direct V2 when the configured release is revoked despite another registered release sharing its action SHA", async () => {
    const facts = await createFacts({
      authorityMissing: true,
      directV2InitializationEnabled: true,
      releaseAttestationStatus: ProducerReleaseAttestationStatus.Revoked,
    }).inspectDirectV2InitializationFacts({
      scmRepositoryIdentityId: "identity-1",
    });

    expect(facts.facts.registeredReleaseSelected).toBe(false);
  });

  it("rejects direct V2 when the configured release is attested but not persisted", async () => {
    const facts = await createFacts({
      authorityMissing: true,
      directV2InitializationEnabled: true,
      persistedRelease: null,
    }).inspectDirectV2InitializationFacts({
      scmRepositoryIdentityId: "identity-1",
    });

    expect(facts.facts.registeredReleaseSelected).toBe(false);
  });

  it("rejects direct V2 when the persisted release immutable tuple differs from the attestation", async () => {
    const facts = await createFacts({
      authorityMissing: true,
      directV2InitializationEnabled: true,
      persistedRelease: {
        ...configuredRelease,
        runtimeCommitSha: "d".repeat(40),
      },
    }).inspectDirectV2InitializationFacts({
      scmRepositoryIdentityId: "identity-1",
    });

    expect(facts.facts.registeredReleaseSelected).toBe(false);
  });
});

const configuredRelease: ProducerRelease = {
  producerReleaseId: "release-v2",
  distributionKind: ProducerDistributionKind.PublicReusable,
  actionCommitSha: "c".repeat(40),
  runtimeCommitSha: "1".repeat(40),
  wrapperEntrypointDigest: null,
  runtimeEntrypointDigest: "2".repeat(64),
  contextGatewayPolicyVersion: "review-context-gateway.v1",
  contextGatewayEntrypointDigest: "3".repeat(64),
  reviewInvestigationProfile: null,
  agentProfiles: null,
  schemaDigest: "4".repeat(64),
  capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
  protocolLimitsProfileId: "limits-v2",
  operationalSloProfileId: "slo-v2",
  state: ProducerReleaseState.Registered,
  registeredAt: new Date("2026-07-20T00:00:00.000Z"),
  revokedAt: null,
};

function createFacts(
  input: {
    readonly inventoryCompatible?: boolean;
    readonly drainNotBefore?: Date;
    readonly dispatchCapabilityAvailable?: boolean;
    readonly authorityMissing?: boolean;
    readonly directV2InitializationEnabled?: boolean;
    readonly releaseAttestationStatus?: ProducerReleaseAttestationStatus;
    readonly persistedRelease?: ProducerRelease | null;
    readonly workflowSchemaVersion?: CodexRotatingT0WorkflowSchemaVersion;
  } = {},
): ProductionReviewMutationAuthorityProofFacts {
  const identity: ScmRepositoryIdentity = {
    scmRepositoryIdentityId: "identity-1",
    provider: ScmProvider.GitHub,
    normalizedSourceBaseUrl: "https://github.com",
    externalRepositoryId: "123",
    version: 1,
    currentWorkspaceId: "workspace-1",
    currentRepositoryConnectionId: "repository-1",
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    boundAt: new Date("2026-07-20T00:00:00.000Z"),
    unboundAt: null,
  };
  const authority: ReviewMutationAuthority = {
    scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
    laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    version: 2,
    epoch: 0n,
    mode: ReviewMutationMode.V1Draining,
    drainPolicyVersion: 1,
    drainStartedAt: new Date("2026-07-22T10:00:00.000Z"),
    v1AdmissionClosedAt: new Date("2026-07-22T10:00:00.000Z"),
    drainNotBefore:
      input.drainNotBefore ?? new Date("2026-07-22T11:00:00.000Z"),
    managedWorkflowInventoryHash: null,
    activationSafetyDecisionHash: null,
    initializedAt: new Date("2026-07-20T00:00:00.000Z"),
    activatedAt: null,
    pausedAt: null,
  };
  return new ProductionReviewMutationAuthorityProofFacts({
    selectedProducerActionCommitSha: () => "c".repeat(40),
    prisma: {
      producerRelease: { count: async () => 1 },
      reviewRunAuthorization: { count: async () => 0 },
    } as unknown as PrismaClient,
    identities: {
      findScmRepositoryIdentityById: async () => identity,
      findScmRepositoryIdentityByExternalIdentity: async () => identity,
    },
    authorities: {
      findReviewMutationAuthority: async () =>
        input.authorityMissing ? null : authority,
    },
    actionRepositories: {
      findSelectedRepositoryByGithubId: async () => ({
        workspaceId: "workspace-1",
        repositoryId: "repository-1",
        githubRepositoryId: "123",
        githubInstallationId: "456",
        fullName: "777genius/example",
        owner: "777genius",
        selected: true,
        installationStatus: "active",
      }),
    },
    releaseAttestations: {
      attest: async () =>
        input.releaseAttestationStatus &&
        input.releaseAttestationStatus !==
          ProducerReleaseAttestationStatus.Attested
          ? { status: input.releaseAttestationStatus }
          : {
              status: ProducerReleaseAttestationStatus.Attested,
              release: configuredRelease,
            },
    },
    producerReleases: {
      findProducerReleaseById: async () =>
        input.persistedRelease === undefined
          ? configuredRelease
          : input.persistedRelease,
    },
    safety: {
      resolveReviewSafetyPolicy: async () => ({
        decisionKind: ReviewSafetyDecisionKind.MutationEpochActivation,
        effectAllowed: true,
        shadow: false,
        emergencyStopped: false,
        capabilityDecisions: [],
        emergencyVersionVector: [],
        safetyDecisionHash: "b".repeat(64),
        resolvedAt: now,
      }),
    },
    workflowInventory: {
      inspectReviewV2ManagedWorkflowInventory: async () => ({
        compatible: input.inventoryCompatible ?? true,
        inventoryHash: "a".repeat(64),
        actionCommitSha: "c".repeat(40),
        runtimeRef: null,
        defaultBranchHeadSha: "d".repeat(40),
        workflowSchemaVersion:
          input.workflowSchemaVersion ??
          CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
      }),
    },
    dispatchCapability: {
      inspectReviewV2DispatchCapability: async () => ({
        available: input.dispatchCapabilityAvailable ?? true,
      }),
    },
    completionWorkerConfigured: true,
    directV2InitializationEnabled: input.directV2InitializationEnabled ?? false,
    now: () => now,
  });
}
