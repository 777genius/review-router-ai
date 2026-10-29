import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type ReviewRunCompanionDispatchV1,
} from "@prisma/client";
import {
  parseReviewModelDispatchCapabilityV2,
  parseReviewModelDispatchProfileV2,
  parseReviewModelDispatchSettlementV2,
  reviewModelDispatchIdPreimage,
  reviewModelDispatchOutputUsageIsWithinLimit,
  type ReviewModelDispatchCapabilityV2,
  type ReviewModelDispatchSettlementV2,
  type ReviewModelDispatchTerminalReceiptV2,
} from "@reviewrouter/shared";
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

  async claim(
    input: ReviewRunCompanionDispatchClaim,
  ): ReturnType<ReviewRunCompanionDispatchRepository["claim"]> {
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
      const budget = modelBudget(auth.runtimeSnapshotCanonicalJson);
      const isModelDispatch = input.dispatchVersion === 2;
      if (!!budget !== isModelDispatch) fail("model_dispatch_version_required");
      if (
        input.forwardExisting &&
        (!budget ||
          !["account_gateway", "hosted_pool"].includes(budget.transport))
      )
        fail("model_dispatch_native_forward_denied");
      if (budget) validateModelClaim(input, budget);
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
      if (budget) {
        const profile = parseReviewModelDispatchProfileV2(
          release.modelDispatchProfile,
        );
        if (
          !profile.transports.includes(budget.transport) ||
          !profile.wireProtocols.includes(budget.wireProtocol) ||
          (budget.configuredModel !== undefined &&
            profile.anthropicModelAliases?.[budget.configuredModel] !==
              budget.model) ||
          [
            "maxRequests",
            "maxConcurrentRequests",
            "maxRequestBytes",
            "maxResponseBytes",
            "maxOutputTokens",
          ].some(
            (key) =>
              Reflect.get(budget, key) > Reflect.get(profile.limits, key),
          ) ||
          new Date(budget.deadline) <= now
        )
          fail("model_dispatch_profile_mismatch");
      }
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
            : budget && slot.taskKind === "finding_discovery"
              ? "finding_discovery"
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
        (role !== "finding_discovery" && slot.required) ||
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
        (role !== "finding_discovery" &&
          Reflect.get(manifest, "providerRequestEnvelopeHash") !==
            input.providerRequestEnvelopeHash)
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
          budget ? Date.parse(budget.deadline) : Infinity,
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
        if (
          budget &&
          (existing.dispatchVersion !== 2 ||
            existing.requestOrdinal !== input.requestOrdinal ||
            existing.routeIdentityHash !== input.routeIdentityHash ||
            existing.requestBytes !== input.requestBytes ||
            existing.maxOutputTokens !== input.maxOutputTokens)
        )
          fail("companion_dispatch_conflict");
        if (input.forwardExisting) {
          if (
            existing.forwardedAt ||
            existing.state !== "dispatch_may_have_started"
          )
            fail("model_dispatch_already_forwarded");
          const forwarded = await tx.reviewRunCompanionDispatchV1.update({
            where: {
              authorizationId_dispatchId: {
                authorizationId: input.authorizationId,
                dispatchId: input.dispatchId,
              },
            },
            data: { forwardedAt: now },
          });
          return {
            status: "claimed" as const,
            dispatch: toDispatch(forwarded),
            notAfter,
          };
        }
        return {
          status: "restored" as const,
          dispatch: toDispatch(existing),
          notAfter,
        };
      }
      if (input.forwardExisting) fail("model_dispatch_reservation_required");
      const discoveryPending = await tx.reviewExecutionWorkSlotV2.count({
        where: {
          executionId: execution.executionId,
          taskKind: "finding_discovery",
          state: { in: ["pending", "leased"] },
        },
      });
      if (role !== "finding_discovery" && discoveryPending)
        fail("phase_not_ready");
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
          ...(budget ? { requestOrdinal: input.requestOrdinal } : {}),
        },
      });
      if (sameSlot) fail("companion_slot_already_claimed");
      if (budget) {
        // Every reservation counts, including positively unpaid outcomes. The
        // authorization lock serializes all roles and fences unknown effects.
        const reserved = await tx.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: input.authorizationId },
        });
        if (reserved >= budget.maxRequests)
          fail("model_dispatch_budget_exhausted");
        const uncertain = await tx.reviewRunCompanionDispatchV1.count({
          where: {
            authorizationId: input.authorizationId,
            state: { in: ["dispatch_may_have_started", "effect_unknown"] },
          },
        });
        if (uncertain) fail("model_dispatch_effect_unresolved");
        const previous = await tx.reviewRunCompanionDispatchV1.count({
          where: {
            authorizationId: input.authorizationId,
            workSlotId: input.workSlotId,
            attemptOrdinal: input.attemptOrdinal,
          },
        });
        if (input.requestOrdinal !== previous + 1)
          fail("model_dispatch_ordinal_invalid");
        if (role !== "finding_discovery" && input.requestOrdinal !== 1)
          fail("companion_slot_already_claimed");
      } else {
        const count = await tx.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: input.authorizationId, role },
        });
        if (count >= (role === "lifecycle_verification" ? 2 : 1))
          fail("companion_dispatch_limit");
      }
      const [finalClock] = await tx.$queryRaw<
        readonly { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      if (
        !finalClock ||
        finalClock.now >= notAfter ||
        finalClock.now >= input.ownershipExpiresAt
      )
        fail("companion_authorization_denied");
      const receiptToken = budget ? randomBytes(32).toString("hex") : undefined;
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
          ...(budget
            ? {
                dispatchVersion: 2,
                requestOrdinal: input.requestOrdinal,
                routeIdentityHash: input.routeIdentityHash,
                requestBytes: input.requestBytes,
                maxOutputTokens: input.maxOutputTokens,
                receiptTokenHash: sha256(receiptToken!),
              }
            : {}),
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
        ...(receiptToken ? { receiptToken } : {}),
      };
    });
  }

  async read(authorizationId: string, dispatchId: string) {
    const row = await this.prisma.reviewRunCompanionDispatchV1.findUnique({
      where: { authorizationId_dispatchId: { authorizationId, dispatchId } },
    });
    return row && (row.dispatchVersion === 1 || row.retainUntil > new Date())
      ? toDispatch(row)
      : null;
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
        dispatchVersion: 1,
        state: { in: ["dispatch_may_have_started", "effect_unknown"] },
      },
      data: {
        state,
        updatedAt: new Date(),
        ...(state !== "effect_unknown" ? { completedAt: new Date() } : {}),
      },
    });
    // Native server proof is additional to the runner's complete wire receipt.
    // This internal port is not exposed by the receipt HTTP endpoint.
    const row = await this.prisma.reviewRunCompanionDispatchV1.findUnique({
      where: { authorizationId_dispatchId: { authorizationId, dispatchId } },
    });
    if (row?.dispatchVersion !== 2 || !row.forwardedAt) return;
    const auth = await this.prisma.reviewRunAuthorization.findUnique({
      where: { authorizationId },
    });
    const budget = modelBudget(auth?.runtimeSnapshotCanonicalJson);
    if (
      !budget ||
      !["account_gateway", "hosted_pool"].includes(budget.transport)
    )
      return;
    await this.prisma.reviewRunCompanionDispatchV1.updateMany({
      where: {
        authorizationId,
        dispatchId,
        dispatchVersion: 2,
        OR: [
          { nativeEffectState: null },
          { nativeEffectState: "effect_unknown" },
        ],
      },
      data: { nativeEffectState: state },
    });
  }

  async readReceipt(dispatchId: string, receiptToken: string) {
    if (!validReceiptToken(receiptToken)) return null;
    const row = await this.prisma.reviewRunCompanionDispatchV1.findUnique({
      where: { receiptTokenHash: sha256(receiptToken) },
    });
    const [clock] = await this.prisma.$queryRaw<
      readonly { now: Date }[]
    >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
    return row &&
      clock &&
      receiptMatches(row, dispatchId, receiptToken, clock.now)
      ? toDispatch(row)
      : null;
  }

  async settleReceipt(
    dispatchId: string,
    receiptToken: string,
    raw: ReviewModelDispatchSettlementV2,
  ) {
    if (!validReceiptToken(receiptToken)) fail("model_dispatch_receipt_denied");
    const settlement = parseReviewModelDispatchSettlementV2(raw);
    return this.prisma.$transaction(async (tx) => {
      const tokenHash = sha256(receiptToken);
      await tx.$queryRaw`SELECT "dispatchId" FROM "ReviewRunCompanionDispatchV1" WHERE "receiptTokenHash" = ${tokenHash} FOR UPDATE`;
      const row = await tx.reviewRunCompanionDispatchV1.findUnique({
        where: { receiptTokenHash: tokenHash },
      });
      const [clock] = await tx.$queryRaw<
        readonly { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      if (
        !row ||
        !clock ||
        !receiptMatches(row, dispatchId, receiptToken, clock.now)
      )
        fail("model_dispatch_receipt_denied");
      const auth = await tx.reviewRunAuthorization.findUnique({
        where: { authorizationId: row.authorizationId },
      });
      const budget = modelBudget(auth?.runtimeSnapshotCanonicalJson);
      if (!budget) fail("model_dispatch_receipt_scope_missing");
      const native = ["account_gateway", "hosted_pool"].includes(
        budget.transport,
      );
      if (
        native &&
        ((settlement.state === "completed" &&
          (!row.forwardedAt || row.nativeEffectState !== "completed")) ||
          (settlement.state === "not_dispatched" &&
            row.forwardedAt &&
            row.nativeEffectState !== "not_dispatched"))
      )
        fail("model_dispatch_native_proof_required");
      if (settlement.state === "completed") {
        const receipt = settlement.receipt;
        if (
          receipt.routeIdentityHash !== row.routeIdentityHash ||
          receipt.routeIdentityHash !== budget.routeIdentityHash ||
          receipt.providerRequestEnvelopeHash !==
            row.providerRequestEnvelopeHash ||
          receipt.actualModel !== budget.model ||
          receipt.responseBytes > budget.maxResponseBytes ||
          !reviewModelDispatchOutputUsageIsWithinLimit(
            receipt.usage,
            row.maxOutputTokens!,
          )
        )
          fail("model_dispatch_receipt_mismatch");
      }
      // A successful upstream terminal fact wins over later delivery failure.
      // Opposite definitive outcomes and changed receipts are conflicts.
      if (row.state === "completed" || row.state === "not_dispatched") {
        if (settlement.state === "effect_unknown") return toDispatch(row);
        if (
          row.state !== settlement.state ||
          (settlement.state === "completed" &&
            canonicalJson(row.terminalReceiptJson) !==
              canonicalJson(settlement.receipt))
        )
          fail("model_dispatch_settlement_conflict");
        return toDispatch(row);
      }
      const updated = await tx.reviewRunCompanionDispatchV1.update({
        where: {
          authorizationId_dispatchId: {
            authorizationId: row.authorizationId,
            dispatchId,
          },
        },
        data: {
          state: settlement.state,
          updatedAt: clock.now,
          ...(settlement.state !== "effect_unknown"
            ? { completedAt: clock.now }
            : {}),
          ...(settlement.state === "completed"
            ? {
                terminalReceiptJson: {
                  ...settlement.receipt,
                  usage: { ...settlement.receipt.usage },
                },
                resultHash: settlement.receipt.responseHash,
                usageHash: sha256(canonicalJson(settlement.receipt.usage)),
              }
            : {}),
        },
      });
      return toDispatch(updated);
    });
  }
}

function fail(code: string): never {
  throw new ReviewRunCompanionDispatchFailure(code);
}
function toDispatch(
  row: ReviewRunCompanionDispatchV1,
): ReviewRunCompanionDispatch {
  if (
    !["finding_discovery", "lifecycle_verification", "pr_description"].includes(
      row.role,
    ) ||
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
    ...(row.dispatchVersion === 2
      ? {
          dispatchVersion: 2 as const,
          requestOrdinal: row.requestOrdinal,
          routeIdentityHash: row.routeIdentityHash!,
          requestBytes: row.requestBytes!,
          maxOutputTokens: row.maxOutputTokens!,
          terminalReceipt:
            row.terminalReceiptJson == null
              ? null
              : (
                  parseReviewModelDispatchSettlementV2({
                    state: "completed",
                    receipt: row.terminalReceiptJson,
                  }) as { receipt: ReviewModelDispatchTerminalReceiptV2 }
                ).receipt,
        }
      : {}),
  };
}

function modelBudget(
  snapshot: string | null | undefined,
): ReviewModelDispatchCapabilityV2 | undefined {
  if (!snapshot) return undefined;
  const raw: unknown = JSON.parse(snapshot);
  if (
    !raw ||
    typeof raw !== "object" ||
    !Object.hasOwn(raw, "modelDispatchCapability")
  )
    return undefined;
  return parseReviewModelDispatchCapabilityV2(
    Reflect.get(raw, "modelDispatchCapability"),
  );
}
function validateModelClaim(
  input: ReviewRunCompanionDispatchClaim,
  budget: ReviewModelDispatchCapabilityV2,
) {
  if (
    input.dispatchVersion !== 2 ||
    input.routeIdentityHash !== budget.routeIdentityHash ||
    !Number.isSafeInteger(input.requestOrdinal) ||
    input.requestOrdinal! < 1 ||
    input.requestOrdinal! > budget.maxRequests ||
    !Number.isSafeInteger(input.requestBytes) ||
    input.requestBytes! < 1 ||
    input.requestBytes! > budget.maxRequestBytes ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens! < 1 ||
    input.maxOutputTokens! > budget.maxOutputTokens ||
    input.dispatchId !==
      `rr-model-${sha256(reviewModelDispatchIdPreimage({ ...input, requestOrdinal: input.requestOrdinal! }))}`
  )
    fail("model_dispatch_claim_invalid");
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function validReceiptToken(token: string) {
  return /^[a-f0-9]{64}$/.test(token);
}
function receiptMatches(
  row: {
    dispatchId: string;
    dispatchVersion: number;
    receiptTokenHash: string | null;
    retainUntil: Date;
  },
  dispatchId: string,
  token: string,
  now: Date,
) {
  const hash = row.receiptTokenHash;
  return (
    row.dispatchId === dispatchId &&
    row.dispatchVersion === 2 &&
    row.retainUntil > now &&
    !!hash &&
    /^[a-f0-9]{64}$/.test(hash) &&
    timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(sha256(token), "hex"))
  );
}
