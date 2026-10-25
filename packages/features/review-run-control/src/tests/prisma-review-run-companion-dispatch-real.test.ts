import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { canonicalJson } from "../domain/review-run-control-types";
import type { ReviewRunCompanionDispatchClaim } from "../application/ports/review-run-companion-dispatch-port";
import { PrismaReviewRunCompanionDispatchRepository } from "../infrastructure/prisma/prisma-review-run-companion-dispatch-repository";
import { limits, sloThresholds } from "./fixtures";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Exercises actual row locks and unique/count constraints. Purpose/profile
 * parsing is covered separately by the API contract tests; this fixture owns
 * only durable reservation authority and intentionally performs no inference. */
describeDatabase("PostgreSQL companion dispatch reservation", () => {
  const prefix = `companion-dispatch-test-${randomUUID()}`;
  let prisma: PrismaClient;
  let repository: PrismaReviewRunCompanionDispatchRepository;
  let claims: ReviewRunCompanionDispatchClaim[];
  let executionId: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/(?:test|ci)/i.test(url.pathname)
    )
      throw new Error("companion_dispatch_disposable_database_required");
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 8 });
    repository = new PrismaReviewRunCompanionDispatchRepository(prisma, {
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
    executionId = `${prefix}-execution`;
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
    const snapshot = canonicalJson({ snapshotVersion: 3, gateway: null });
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
          { providerKind: "codex", providerVoteIdentityHash: digest("vote") },
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
        providerVoteIdentityHash: digest("vote"),
        shardKey: "discovery",
        required: true,
        attemptBudget: 1,
        retryPolicyVersion: "test-v1",
        state: "pending",
      },
    });
    claims = [];
    for (let index = 1; index <= 3; index++) {
      const workSlotId = `lifecycle-${index}`;
      const leaseId = `${prefix}-lease-${index}`;
      await prisma.reviewExecutionWorkSlotV2.create({
        data: {
          executionId,
          workSlotId,
          planOrdinal: index,
          taskKind: "lifecycle_revalidation",
          providerKind: "codex",
          providerVoteIdentityHash: digest("vote"),
          shardKey: workSlotId,
          required: false,
          attemptBudget: 1,
          retryPolicyVersion: "test-v1",
          state: "leased",
          activeLeaseId: leaseId,
        },
      });
      const lease = await prisma.reviewInvocationLeaseV2.create({
        data: {
          ...scope,
          leaseId,
          executionId,
          executionGeneration: 1n,
          providerInvocationKey: digest(`${prefix}-invocation-${index}`),
          preparedManifestCanonicalJson: canonicalJson({
            taskKindSet: ["lifecycle_revalidation"],
            providerRequestEnvelopeHash: digest("request"),
          }),
          preparedManifestKey: digest(`${prefix}-manifest-${index}`),
          providerVoteIdentityHash: digest("vote"),
          workSlotId,
          purpose: "provider_execution",
          authorizationId,
          producerReleaseId: `${prefix}-release`,
          reviewRevisionHash: digest("revision"),
          mutationEpoch: 1n,
          leaseSafetyDecisionHash: digest("safety"),
          attemptId: `${prefix}-attempt-${index}`,
          attemptOrdinal: 1,
          acquireRequestIdHash: digest(`${prefix}-acquire-${index}`),
          acquireRequestHash: digest(`${prefix}-acquire-body-${index}`),
          ownerIdHash: digest("owner"),
          leaseCapabilityId: `${prefix}-cap-${index}`,
          capabilitySigningKeyId: "test-key",
          acquiredAt: now,
          renewedAt: now,
          expiresAt: deadline,
          resultReportUntil: deadline,
          retainUntil: deadline,
        },
      });
      claims.push({
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
        ownershipExpiresAt: deadline,
        capabilityMutationEpoch: 1n,
        capabilityReviewRevisionHash: digest("revision"),
        capabilityScopeHash: digest(canonicalJson(scope)),
      });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
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
  });

  it("rejects nonterminal discovery and forged lease/hash before claiming", async () => {
    await expect(repository.claim(claims[0]!)).rejects.toMatchObject({
      code: "phase_not_ready",
    });
    await prisma.reviewExecutionWorkSlotV2.update({
      where: {
        executionId_workSlotId: { executionId, workSlotId: "discovery" },
      },
      data: { state: "exhausted" },
    });
    await expect(
      repository.claim({
        ...claims[0]!,
        fencingToken: claims[0]!.fencingToken + 1n,
      }),
    ).rejects.toMatchObject({ code: "companion_lease_mismatch" });
    await expect(
      repository.claim({
        ...claims[0]!,
        providerRequestEnvelopeHash: digest("forged"),
      }),
    ).rejects.toMatchObject({ code: "companion_envelope_mismatch" });
    expect(
      await prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: claims[0]!.authorizationId },
      }),
    ).toBe(0);
  });

  it("serializes concurrent duplicates, survives a new repository, and never refunds unpaid attempts", async () => {
    await prisma.reviewExecutionWorkSlotV2.update({
      where: {
        executionId_workSlotId: { executionId, workSlotId: "discovery" },
      },
      data: { state: "exhausted" },
    });
    const pair = await Promise.all([
      repository.claim(claims[0]!),
      repository.claim(claims[0]!),
    ]);
    expect(pair.map((row) => row.status).sort()).toEqual([
      "claimed",
      "restored",
    ]);
    expect(pair[0]!.dispatch.nativeRequestRef).toBe(
      pair[1]!.dispatch.nativeRequestRef,
    );
    await expect(
      repository.claim({ ...claims[0]!, dispatchId: `${prefix}-new-id` }),
    ).rejects.toMatchObject({ code: "companion_slot_already_claimed" });
    await repository.settle(
      claims[0]!.authorizationId,
      claims[0]!.dispatchId,
      "not_dispatched",
    );
    const restored = new PrismaReviewRunCompanionDispatchRepository(prisma, {
      lockSelection: async () => true,
      validateManifest: () => {},
    });
    await expect(restored.claim(claims[0]!)).resolves.toMatchObject({
      status: "restored",
      dispatch: { state: "not_dispatched" },
    });
    await repository.claim(claims[1]!);
    await expect(repository.claim(claims[2]!)).rejects.toMatchObject({
      code: "companion_dispatch_limit",
    });
    await repository.settle(
      claims[1]!.authorizationId,
      claims[1]!.dispatchId,
      "completed",
    );
    await repository.settle(
      claims[1]!.authorizationId,
      claims[1]!.dispatchId,
      "effect_unknown",
    );
    expect(
      (await restored.read(claims[1]!.authorizationId, claims[1]!.dispatchId))
        ?.state,
    ).toBe("completed");
  });
});
