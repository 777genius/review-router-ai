import { createHash } from "node:crypto";
import { expect } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import {
  canonicalJson,
  type ReviewOperationalSloThresholds,
  type ReviewProtocolLimits,
  type ReviewRunCompanionDispatchClaim,
} from "@reviewrouter/features-review-run-control";
import { PrismaReviewRunCompanionDispatchRepository } from "@reviewrouter/features-review-run-control/composition";
import { ReviewInvocationLeasePurpose } from "@reviewrouter/features-review-executions";
import { PrismaReviewExecutionStore } from "@reviewrouter/features-review-executions/composition";
import type { ReviewModelDispatchProfileV2 } from "@reviewrouter/shared";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const limits: ReviewProtocolLimits = {
  maxWorkSlots: 200,
  maxAttemptsPerSlot: 4,
  maxObservationBytes: 1_000_000,
  maxObservationFindings: 1_000,
  maxProjectionBytes: 2_000_000,
  maxProjectionFindings: 2_000,
  maxPublicationOperations: 500,
  maxPublicationChunks: 500,
  maxPublicationBodyBytes: 2_000_000,
  maxRequestBatchSize: 100,
  maxLeaseDurationMs: 600_000,
  maxResultReportDurationMs: 1_200_000,
  maxReconciliationDurationMs: 3_600_000,
};

const sloThresholds: ReviewOperationalSloThresholds = {
  integrationEventDeliveryMs: 60_000,
  outboxClaimAgeMs: 120_000,
  missingCompletionProcessMs: 300_000,
  dueCompletionProcessMs: 300_000,
  publicationReconciliationMs: 600_000,
  v1DrainMs: 3_600_000,
  admissionMs: 30_000,
  pruningBacklogAgeMs: 86_400_000,
};

/** Shared real PostgreSQL lease/authorization fixture for historical and V2
 * dispatch contracts; no upstream credentials or inference are involved. */
export async function createReviewDispatchDatabaseFixture(
  databaseUrl: string,
  prefix: string,
  options: {
    runtimeSnapshotCanonicalJson?: string;
    modelDispatchProfile?: ReviewModelDispatchProfileV2;
    skipInitialLease?: boolean;
  } = {},
) {
  const providerVoteIdentityHash = digest(`${prefix}-vote`);

  const url = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/(?:test|ci)/i.test(url.pathname)
  )
    throw new Error("companion_dispatch_disposable_database_required");
  const prisma = createPrismaClient({ databaseUrl: databaseUrl, poolMax: 8 });
  const executions = new PrismaReviewExecutionStore(prisma);
  const repository = new PrismaReviewRunCompanionDispatchRepository(prisma, {
    lockSelection: async () => true,
    validateManifest(_authorization, slot, manifest) {
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Reflect.get(manifest, "taskKindSet")?.[0] !== slot.taskKind
      )
        throw new Error("fixture_manifest_purpose_mismatch");
    },
  });
  const now = new Date();
  const deadline = new Date(now.getTime() + 600_000);
  const workspaceId = `${prefix}-workspace`;
  const repositoryConnectionId = `${prefix}-repository`;
  const scmRepositoryIdentityId = `${prefix}-scm`;
  const authorizationId = `${prefix}-auth`;
  const executionId = `${prefix}-execution`;
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      slug: workspaceId,
      name: "Companion dispatch SQL test",
    },
  });
  await prisma.reviewProtocolLimitsV2.create({
    data: {
      protocolLimitsProfileId: `${prefix}-limits`,
      limitsDigest: digest(`${prefix}-limits`),
      ...limits,
      registeredAt: now,
    },
  });
  await prisma.reviewOperationalSloProfileV2.create({
    data: {
      operationalSloProfileId: `${prefix}-slo`,
      sloDigest: digest(`${prefix}-slo`),
      ...sloThresholds,
      ownerRefs: ["test"],
      runbookRefs: ["test"],
      registeredAt: now,
    },
  });
  await prisma.producerRelease.create({
    data: {
      producerReleaseId: `${prefix}-release`,
      ...(options.modelDispatchProfile
        ? {
            modelDispatchProfile: JSON.parse(
              canonicalJson(options.modelDispatchProfile),
            ),
          }
        : {}),
      distributionKind: "public_reusable",
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "b".repeat(40),
      runtimeEntrypointDigest: digest(prefix),
      schemaDigest: digest(`${prefix}-schema`),
      capabilityProfile: "exact_revision_v2",
      protocolLimitsProfileId: `${prefix}-limits`,
      operationalSloProfileId: `${prefix}-slo`,
      registeredAt: now,
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.scmRepositoryIdentity.create({
      data: {
        scmRepositoryIdentityId,
        provider: "github",
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: prefix,
        currentWorkspaceId: workspaceId,
        currentRepositoryConnectionId: repositoryConnectionId,
        createdAt: now,
        boundAt: now,
      },
    });
    await tx.repositoryConnection.create({
      data: {
        id: repositoryConnectionId,
        workspaceId,
        provider: "github",
        sourceBaseUrl: "https://github.com",
        externalRepositoryId: prefix,
        scmRepositoryIdentityId,
        owner: "disposable",
        name: prefix,
        fullName: `disposable/${prefix}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
  });
  await prisma.reviewMutationAuthority.create({
    data: {
      scmRepositoryIdentityId,
      laneKind: "hosted_reviewrouter_app",
      epoch: 1n,
      mode: "v2_active",
      initializedAt: now,
      activatedAt: now,
    },
  });
  const scope = {
    workspaceId,
    repositoryConnectionId,
    scmRepositoryIdentityId,
    pullRequestNumber: 1,
  };
  const snapshot =
    options.runtimeSnapshotCanonicalJson ??
    canonicalJson({ snapshotVersion: 3, gateway: null });
  await prisma.reviewRunAuthorization.create({
    data: {
      ...scope,
      authorizationId,
      sourceRunId: `${prefix}-run`,
      sourceRunAttempt: "1",
      workflowIdentityHash: digest("workflow"),
      baseSha: "b".repeat(40),
      mergeBaseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      reviewRevisionHash: digest("revision"),
      trustDomain: "trusted_managed",
      producerReleaseId: `${prefix}-release`,
      selectedProtocolVersion: "review_action_v2",
      schemaDigest: digest(`${prefix}-schema`),
      protocolLimitsProfileId: `${prefix}-limits`,
      operationalSloProfileId: `${prefix}-slo`,
      mutationEpoch: 1n,
      providerVoteLanes: [
        {
          providerKind: "codex",
          providerVoteIdentityHash,
        },
      ],
      runtimeSnapshotCanonicalJson: snapshot,
      authorizationSafetyDecisionHash: digest("safety"),
      protocolOfferHash: digest(`${prefix}-offer`),
      oidcReplayKeyHash: digest(`${prefix}-replay`),
      tokenSigningKeyId: "test-key",
      tokenIssuer: "reviewrouter-review-run-control",
      tokenAudience: "review_run",
      expiresAt: deadline,
      maxExpiresAt: deadline,
      createdAt: now,
    },
  });
  await prisma.reviewExecutionV2.create({
    data: {
      ...scope,
      executionId,
      generation: 1n,
      baseSha: "b".repeat(40),
      mergeBaseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      reviewRevisionHash: digest("revision"),
      compatibilityKey: digest("compatibility"),
      planHash: digest("plan"),
      startIdentityHash: digest(`${prefix}-start`),
      canonicalStartHash: digest(`${prefix}-canonical-start`),
      state: "running",
      authorizationId,
      producerReleaseId: `${prefix}-release`,
      mutationEpoch: 1n,
      admissionSafetyDecisionHash: digest("safety"),
      protocolLimitsProfileId: `${prefix}-limits`,
      sourceRunId: `${prefix}-run`,
      sourceRunAttempt: "1",
      createdAt: now,
      updatedAt: now,
      admissionDeadlineAt: deadline,
      admissionCheckedAt: now,
      executionDeadlineAt: deadline,
      retainUntil: deadline,
    },
  });
  await prisma.reviewExecutionStreamV2.create({
    data: {
      ...scope,
      activeExecutionId: executionId,
      lastAllocatedGeneration: 1n,
      currentBaseSha: "b".repeat(40),
      currentMergeBaseSha: "b".repeat(40),
      currentHeadSha: "a".repeat(40),
      currentReviewRevisionHash: digest("revision"),
      updatedAt: now,
    },
  });
  await prisma.reviewExecutionWorkSlotV2.create({
    data: {
      executionId,
      workSlotId: "discovery",
      planOrdinal: 0,
      taskKind: "finding_discovery",
      providerKind: "codex",
      providerVoteIdentityHash,
      shardKey: "discovery",
      required: true,
      attemptBudget: 1,
      retryPolicyVersion: "test-v1",
      state: "pending",
    },
  });
  const claims: ReviewRunCompanionDispatchClaim[] = [];
  for (let index = 1; index <= 3; index++) {
    const workSlotId =
      index === 0
        ? "discovery"
        : options.modelDispatchProfile && index === 3
          ? "description"
          : `lifecycle-${index}`;
    await prisma.reviewExecutionWorkSlotV2.create({
      data: {
        executionId,
        workSlotId,
        planOrdinal: index,
        taskKind:
          options.modelDispatchProfile && index === 3
            ? "pr_description"
            : "lifecycle_revalidation",
        providerKind: "codex",
        providerVoteIdentityHash,
        shardKey: workSlotId,
        required: false,
        attemptBudget: 1,
        retryPolicyVersion: "test-v1",
        state: "pending",
      },
    });
  }
  // Companion packets run after discovery and sequentially on the admitted
  // vote identity. The mixed-fleet guard must stay enabled: concurrent
  // dispatch claims below share ONE current lease, not three active leases.
  const acquireClaim = async (index: number) => {
    const workSlotId =
      index === 0
        ? "discovery"
        : options.modelDispatchProfile && index === 3
          ? "description"
          : `lifecycle-${index}`;
    const leaseId = `${prefix}-lease-${index}`;
    const requestedAt = new Date();
    const acquired = await executions.acquireLease({
      scope,
      leaseId,
      executionId,
      workSlotId,
      purpose: ReviewInvocationLeasePurpose.ProviderExecution,
      providerInvocationKey: digest(`${prefix}-invocation-${index}`),
      preparedManifestCanonicalJson: canonicalJson({
        taskKindSet: [
          index === 0
            ? "finding_discovery"
            : options.modelDispatchProfile && index === 3
              ? "pr_description"
              : "lifecycle_revalidation",
        ],
        providerRequestEnvelopeHash: digest("request"),
      }),
      preparedManifestKey: digest(`${prefix}-manifest-${index}`),
      providerVoteIdentityHash,
      attemptId: `${prefix}-attempt-${index}`,
      sourceObservationId: null,
      acquireRequestIdHash: digest(`${prefix}-acquire-${index}`),
      acquireRequestHash: digest(`${prefix}-acquire-body-${index}`),
      ownerIdHash: digest("owner"),
      leaseCapabilityId: `${prefix}-cap-${index}`,
      capabilitySigningKeyId: "test-key",
      leaseSafetyDecisionHash: digest("safety"),
      now: requestedAt,
      expiresAt: new Date(requestedAt.getTime() + 60_000),
      resultReportUntil: new Date(requestedAt.getTime() + 120_000),
      retainUntil: deadline,
      limits: {
        profileId: `${prefix}-limits`,
        maxWorkSlots: limits.maxWorkSlots,
        maxAttemptBudget: limits.maxAttemptsPerSlot,
        maxProjectionBytes: limits.maxProjectionBytes,
        maxFindingCount: limits.maxProjectionFindings,
        maxLeaseDurationMs: limits.maxLeaseDurationMs,
        maxResultReportDurationMs: limits.maxResultReportDurationMs,
      },
    });
    expect(acquired.status).toBe("acquired");
    const lease = acquired.lease!;
    return {
      authorizationId,
      runtimeSnapshotCanonicalJson: snapshot,
      dispatchId: `${prefix}-dispatch-${index}`,
      executionId,
      workSlotId,
      attemptOrdinal: 1,
      leaseId,
      fencingToken: lease.fencingToken,
      preparedManifestKey: lease.preparedManifestKey!,
      providerRequestEnvelopeHash: digest("request"),
      leaseCapabilityId: lease.leaseCapabilityId,
      ownerIdHash: lease.ownerIdHash,
      providerInvocationKey: lease.providerInvocationKey,
      ownershipExpiresAt: lease.expiresAt,
      capabilityMutationEpoch: 1n,
      capabilityReviewRevisionHash: digest("revision"),
      capabilityScopeHash: digest(canonicalJson(scope)),
    };
  };
  if (!options.skipInitialLease) claims.push(await acquireClaim(1));
  async function releaseClaim(claim: ReviewRunCompanionDispatchClaim) {
    const released = await executions.releaseLease({
      leaseId: claim.leaseId,
      ownerIdHash: claim.ownerIdHash,
      leaseCapabilityId: claim.leaseCapabilityId,
      fencingToken: claim.fencingToken,
      now: new Date(),
    });
    expect(released.status).toBe("applied");
    expect(released.lease?.state).toBe("released");
  }

  async function dispose() {
    await prisma.reviewRunCompanionDispatchV1.deleteMany({
      where: { authorizationId: `${prefix}-auth` },
    });
    await prisma.reviewInvocationLeaseV2.deleteMany({ where: { executionId } });
    await prisma.reviewExecutionWorkSlotV2.deleteMany({
      where: { executionId },
    });
    await prisma.reviewExecutionV2.deleteMany({ where: { executionId } });
    await prisma.reviewExecutionStreamV2.deleteMany({
      where: { workspaceId: `${prefix}-workspace` },
    });
    await prisma.reviewRunAuthorization.deleteMany({
      where: { authorizationId: `${prefix}-auth` },
    });
    await prisma.reviewMutationAuthority.deleteMany({
      where: { scmRepositoryIdentityId: `${prefix}-scm` },
    });
    await prisma.$transaction(async (tx) => {
      await tx.scmRepositoryIdentity.updateMany({
        where: { scmRepositoryIdentityId: `${prefix}-scm` },
        data: { currentWorkspaceId: null, currentRepositoryConnectionId: null },
      });
      await tx.repositoryConnection.updateMany({
        where: { id: `${prefix}-repository` },
        data: { scmRepositoryIdentityId: null },
      });
    });
    await prisma.repositoryConnection.deleteMany({
      where: { id: `${prefix}-repository` },
    });
    await prisma.scmRepositoryIdentity.deleteMany({
      where: { scmRepositoryIdentityId: `${prefix}-scm` },
    });
    await prisma.workspace.deleteMany({ where: { id: `${prefix}-workspace` } });
    await prisma.producerRelease.deleteMany({
      where: { producerReleaseId: `${prefix}-release` },
    });
    await prisma.reviewProtocolLimitsV2.deleteMany({
      where: { protocolLimitsProfileId: `${prefix}-limits` },
    });
    await prisma.reviewOperationalSloProfileV2.deleteMany({
      where: { operationalSloProfileId: `${prefix}-slo` },
    });
    await prisma.$disconnect();
  }
  return {
    prisma,
    repository,
    executions,
    executionId,
    claims,
    acquireClaim,
    releaseClaim,
    dispose,
    scope,
    snapshot,
  };
}
