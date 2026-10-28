import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ReviewRunCompanionDispatchFailure,
  type ReviewRunCompanionDispatch,
  type ReviewRunCompanionDispatchClaim,
  type ReviewRunCompanionDispatchRepository,
  type ReviewRunCompanionRole,
} from "../../application/ports/review-run-companion-dispatch-port";
import type { ReviewRunAuthorization } from "../../domain/review-run-authorization";
import { canonicalJson } from "../../domain/review-run-control-types";
import { reviewRunAuthorizationToDomain } from "./prisma-review-run-control-mappers";

type ManifestFacts = Readonly<{
  taskKind: string;
  providerKind: string;
  providerVoteIdentityHash: string;
  required: boolean;
  attemptBudget: number;
  workSlotId: string;
}>;
type DispatchDependencies = Readonly<{
  validateManifest(
    authorization: ReviewRunAuthorization,
    slot: ManifestFacts,
    manifest: unknown,
    assignmentManifest: unknown,
    timing: Readonly<{ now: Date; executionDeadlineAt: Date }>,
  ): void;
  /** Runs on this transaction before the authorization lock, in the existing
   * selection lock order. Required by production composition. */
  lockSelection(
    transaction: Prisma.TransactionClient,
    authorization: ReviewRunAuthorization,
  ): Promise<boolean>;
}>;

/** The auth row serializes every companion reservation, across processes and
 * executions. Network inference is deliberately outside this transaction. */
export class PrismaReviewRunCompanionDispatchRepository implements ReviewRunCompanionDispatchRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: DispatchDependencies,
  ) {}

  async claim(input: ReviewRunCompanionDispatchClaim) {
    return this.prisma.$transaction(async (tx) => {
      const first = await tx.reviewRunAuthorization.findUnique({
        where: { authorizationId: input.authorizationId },
      });
      if (
        !first ||
        !(await this.dependencies.lockSelection(
          tx,
          reviewRunAuthorizationToDomain(first),
        ))
      )
        fail("companion_authorization_denied");
      await tx.$queryRaw`SELECT "authorizationId" FROM "ReviewRunAuthorization" WHERE "authorizationId" = ${input.authorizationId} FOR UPDATE`;
      const auth = await tx.reviewRunAuthorization.findUnique({
        where: { authorizationId: input.authorizationId },
      });
      if (
        !auth ||
        auth.state !== "active" ||
        auth.runtimeSnapshotCanonicalJson !== input.runtimeSnapshotCanonicalJson
      )
        fail("companion_authorization_denied");
      // Lock the stream and lease too: their writers do not use the auth lock.
      await tx.$queryRaw`SELECT "activeExecutionId" FROM "ReviewExecutionStreamV2" WHERE "workspaceId" = ${auth.workspaceId} AND "repositoryConnectionId" = ${auth.repositoryConnectionId} AND "scmRepositoryIdentityId" = ${auth.scmRepositoryIdentityId} AND "pullRequestNumber" = ${auth.pullRequestNumber} FOR SHARE`;
      await tx.$queryRaw`SELECT "leaseId" FROM "ReviewInvocationLeaseV2" WHERE "leaseId" = ${input.leaseId} FOR SHARE`;
      const execution = await tx.reviewExecutionV2.findUnique({
        where: { executionId: input.executionId },
      });
      const lease = await tx.reviewInvocationLeaseV2.findUnique({
        where: { leaseId: input.leaseId },
      });
      const stream = await tx.reviewExecutionStreamV2.findUnique({
        where: {
          workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
            {
              workspaceId: auth.workspaceId,
              repositoryConnectionId: auth.repositoryConnectionId,
              scmRepositoryIdentityId: auth.scmRepositoryIdentityId,
              pullRequestNumber: auth.pullRequestNumber,
            },
        },
      });
      const slot = await tx.reviewExecutionWorkSlotV2.findUnique({
        where: {
          executionId_workSlotId: {
            executionId: input.executionId,
            workSlotId: input.workSlotId,
          },
        },
      });
      const release = await tx.producerRelease.findUnique({
        where: { producerReleaseId: auth.producerReleaseId },
      });
      const mutation = await tx.reviewMutationAuthority.findUnique({
        where: {
          scmRepositoryIdentityId_laneKind: {
            scmRepositoryIdentityId: auth.scmRepositoryIdentityId,
            laneKind: "hosted_reviewrouter_app",
          },
        },
      });
      const [{ now } = {}] = await tx.$queryRaw<
        readonly { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      if (
        !now ||
        auth.expiresAt <= now ||
        auth.maxExpiresAt <= now ||
        input.ownershipExpiresAt <= now ||
        !release ||
        release.state !== "registered" ||
        !mutation ||
        mutation.mode !== "v2_active" ||
        mutation.epoch !== auth.mutationEpoch
      )
        fail("companion_authorization_denied");
      if (
        !execution ||
        !lease ||
        !stream ||
        !slot ||
        stream.activeExecutionId !== execution.executionId ||
        stream.lastAllocatedGeneration !== execution.generation ||
        stream.currentHeadSha !== auth.headSha ||
        stream.currentReviewRevisionHash !== auth.reviewRevisionHash ||
        execution.authorizationId !== auth.authorizationId ||
        execution.producerReleaseId !== auth.producerReleaseId ||
        execution.reviewRevisionHash !== auth.reviewRevisionHash ||
        execution.headSha !== auth.headSha ||
        execution.mutationEpoch !== auth.mutationEpoch ||
        execution.executionDeadlineAt <= now ||
        !["planned", "running"].includes(execution.state)
      )
        fail("companion_execution_not_current");
      const role: ReviewRunCompanionRole =
        slot.taskKind === "lifecycle_revalidation"
          ? "lifecycle_verification"
          : slot.taskKind === "pr_description"
            ? "pr_description"
            : fail("companion_slot_purpose_invalid");
      if (
        lease.executionId !== execution.executionId ||
        lease.workspaceId !== auth.workspaceId ||
        lease.repositoryConnectionId !== auth.repositoryConnectionId ||
        lease.scmRepositoryIdentityId !== auth.scmRepositoryIdentityId ||
        lease.pullRequestNumber !== auth.pullRequestNumber ||
        execution.workspaceId !== auth.workspaceId ||
        execution.repositoryConnectionId !== auth.repositoryConnectionId ||
        execution.scmRepositoryIdentityId !== auth.scmRepositoryIdentityId ||
        execution.pullRequestNumber !== auth.pullRequestNumber ||
        lease.executionGeneration !== execution.generation ||
        lease.authorizationId !== auth.authorizationId ||
        lease.producerReleaseId !== auth.producerReleaseId ||
        lease.mutationEpoch !== auth.mutationEpoch ||
        lease.reviewRevisionHash !== auth.reviewRevisionHash ||
        lease.workSlotId !== slot.workSlotId ||
        lease.providerVoteIdentityHash !== slot.providerVoteIdentityHash ||
        lease.leaseCapabilityId !== input.leaseCapabilityId ||
        lease.ownerIdHash !== input.ownerIdHash ||
        lease.providerInvocationKey !== input.providerInvocationKey ||
        lease.fencingToken !== input.fencingToken ||
        lease.preparedManifestKey !== input.preparedManifestKey ||
        lease.purpose !== "provider_execution" ||
        lease.sourceObservationId !== null ||
        input.capabilityMutationEpoch !== auth.mutationEpoch ||
        input.capabilityReviewRevisionHash !== auth.reviewRevisionHash ||
        input.capabilityScopeHash !==
          createHash("sha256")
            .update(
              canonicalJson({
                workspaceId: auth.workspaceId,
                repositoryConnectionId: auth.repositoryConnectionId,
                scmRepositoryIdentityId: auth.scmRepositoryIdentityId,
                pullRequestNumber: auth.pullRequestNumber,
              }),
            )
            .digest("hex") ||
        input.attemptOrdinal !== 1 ||
        lease.attemptOrdinal !== 1 ||
        slot.attemptBudget !== 1 ||
        slot.required ||
        !lease.preparedManifestCanonicalJson
      )
        fail("companion_lease_mismatch");
      let manifest: unknown;
      try {
        manifest = JSON.parse(lease.preparedManifestCanonicalJson);
      } catch {
        fail("companion_manifest_invalid");
      }
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Reflect.get(manifest, "providerRequestEnvelopeHash") !==
          input.providerRequestEnvelopeHash
      )
        fail("companion_envelope_mismatch");
      this.dependencies.validateManifest(
        reviewRunAuthorizationToDomain(auth),
        slot,
        manifest,
        execution.assignmentManifestJson,
        { now, executionDeadlineAt: execution.executionDeadlineAt },
      );
      // Signed POST admission requires current ownership; readback after release
      // uses the separate bearer-authenticated read method.
      if (
        lease.state !== "active" ||
        lease.expiresAt <= now ||
        slot.state !== "leased" ||
        slot.activeLeaseId !== lease.leaseId
      )
        fail("companion_lease_not_active");
      const notAfter = new Date(
        Math.min(
          auth.expiresAt.getTime(),
          auth.maxExpiresAt.getTime(),
          execution.executionDeadlineAt.getTime(),
          lease.expiresAt.getTime(),
        ),
      );
      const existing = await tx.reviewRunCompanionDispatchV1.findUnique({
        where: {
          authorizationId_dispatchId: {
            authorizationId: input.authorizationId,
            dispatchId: input.dispatchId,
          },
        },
      });
      if (existing) {
        for (const key of [
          "executionId",
          "workSlotId",
          "attemptOrdinal",
          "leaseId",
          "fencingToken",
          "preparedManifestKey",
          "providerRequestEnvelopeHash",
        ] as const)
          if (existing[key] !== input[key]) fail("companion_dispatch_conflict");
        return {
          status: "restored" as const,
          dispatch: toDispatch(existing),
          notAfter,
        };
      }
      const discoveryPending = await tx.reviewExecutionWorkSlotV2.count({
        where: {
          executionId: execution.executionId,
          taskKind: "finding_discovery",
          state: { in: ["pending", "leased"] },
        },
      });
      if (discoveryPending) fail("phase_not_ready");
      if (
        role === "pr_description" &&
        (await tx.reviewExecutionWorkSlotV2.count({
          where: {
            executionId: execution.executionId,
            taskKind: "lifecycle_revalidation",
            state: { in: ["pending", "leased"] },
          },
        }))
      )
        fail("phase_not_ready");
      const sameSlot = await tx.reviewRunCompanionDispatchV1.findFirst({
        where: {
          authorizationId: input.authorizationId,
          workSlotId: input.workSlotId,
          attemptOrdinal: input.attemptOrdinal,
        },
      });
      if (sameSlot) fail("companion_slot_already_claimed");
      const count = await tx.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: input.authorizationId, role },
      });
      if (count >= (role === "lifecycle_verification" ? 2 : 1))
        fail("companion_dispatch_limit");
      const [finalClock] = await tx.$queryRaw<
        readonly { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      if (
        !finalClock ||
        finalClock.now >= notAfter ||
        finalClock.now >= input.ownershipExpiresAt
      )
        fail("companion_authorization_denied");
      const row = await tx.reviewRunCompanionDispatchV1.create({
        data: {
          authorizationId: input.authorizationId,
          dispatchId: input.dispatchId,
          executionId: input.executionId,
          workSlotId: input.workSlotId,
          attemptOrdinal: 1,
          leaseId: input.leaseId,
          fencingToken: input.fencingToken,
          preparedManifestKey: input.preparedManifestKey,
          providerRequestEnvelopeHash: input.providerRequestEnvelopeHash,
          role,
          nativeRequestRef: `rr-companion-${randomUUID()}`,
          state: "dispatch_may_have_started",
          createdAt: now,
          updatedAt: now,
          claimedAt: now,
          retainUntil: new Date(
            Math.max(
              auth.maxExpiresAt.getTime(),
              execution.retainUntil.getTime(),
              lease.retainUntil.getTime(),
            ),
          ),
        },
      });
      return {
        status: "claimed" as const,
        dispatch: toDispatch(row),
        notAfter,
      };
    });
  }

  async read(authorizationId: string, dispatchId: string) {
    const row = await this.prisma.reviewRunCompanionDispatchV1.findUnique({
      where: { authorizationId_dispatchId: { authorizationId, dispatchId } },
    });
    return row ? toDispatch(row) : null;
  }

  async settle(
    authorizationId: string,
    dispatchId: string,
    state: "completed" | "not_dispatched" | "effect_unknown",
  ) {
    await this.prisma.reviewRunCompanionDispatchV1.updateMany({
      where: {
        authorizationId,
        dispatchId,
        state: { in: ["dispatch_may_have_started", "effect_unknown"] },
      },
      data: {
        state,
        updatedAt: new Date(),
        ...(state !== "effect_unknown" ? { completedAt: new Date() } : {}),
      },
    });
  }
}

function fail(code: string): never {
  throw new ReviewRunCompanionDispatchFailure(code);
}
function toDispatch(
  row: Omit<ReviewRunCompanionDispatch, "role" | "state"> & {
    role: string;
    state: string;
  },
): ReviewRunCompanionDispatch {
  if (
    !["lifecycle_verification", "pr_description"].includes(row.role) ||
    ![
      "dispatch_may_have_started",
      "effect_unknown",
      "completed",
      "not_dispatched",
    ].includes(row.state)
  )
    fail("companion_dispatch_corrupt");
  return {
    authorizationId: row.authorizationId,
    dispatchId: row.dispatchId,
    executionId: row.executionId,
    workSlotId: row.workSlotId,
    attemptOrdinal: row.attemptOrdinal,
    leaseId: row.leaseId,
    fencingToken: row.fencingToken,
    preparedManifestKey: row.preparedManifestKey,
    providerRequestEnvelopeHash: row.providerRequestEnvelopeHash,
    nativeRequestRef: row.nativeRequestRef,
    role: row.role as ReviewRunCompanionDispatch["role"],
    state: row.state as ReviewRunCompanionDispatch["state"],
  };
}
