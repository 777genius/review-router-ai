import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import {
  normalizeProviderInvocationManifest,
  ProviderExecutionProfile,
  type ProviderInvocationManifest,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewTaskKind,
  type ReviewWorkSlotPlan,
} from "@reviewrouter/features-review-executions";
import {
  canonicalJson,
  ClaimReviewRunCompanionDispatch,
  ReviewRunCompanionDispatchFailure,
  parseReviewRunRuntimeSnapshot,
  getPrimaryReviewRunReviewer,
  reviewAgentExecutionProviderKind,
  type CompanionLeaseAuthority,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { PrismaReviewRunCompanionDispatchRepository } from "@reviewrouter/features-review-run-control/composition";
import { ReviewActionV2ProtocolErrorCode } from "@reviewrouter/protocol-review-action-v2";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  type LifecycleVerificationCapabilityV1,
} from "@reviewrouter/shared";
import { assertPrDescriptionManifest } from "./review-pr-description";

type Authorization = Pick<
  ReviewRunAuthorization,
  "runtimeSnapshotCanonicalJson" | "providerVoteLanes"
>;
type Slot = Pick<
  ReviewWorkSlotPlan,
  | "workSlotId"
  | "taskKind"
  | "providerKind"
  | "providerVoteIdentityHash"
  | "attemptBudget"
  | "required"
>;
function requireFact(value: unknown, issue: string): asserts value {
  if (!value)
    throw new ReviewActionV2RouteFailure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      [issue],
    );
}
function primary(authorization: Authorization) {
  const snapshot = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  const capability = snapshot?.lifecycleVerificationCapability;
  requireFact(
    snapshot && capability,
    "lifecycle_verification_capture_required",
  );
  const configuration = parseReviewConfigurationStrict(
    JSON.parse(snapshot.configurationCanonicalJson),
  );
  const provider = configuration.providers[capability.providerIndex];
  const reviewer =
    snapshot.snapshotVersion === 4
      ? getPrimaryReviewRunReviewer(snapshot)
      : null;
  requireFact(
    (snapshot.snapshotVersion === 3
      ? snapshot.gateway?.providerIndex
      : reviewer!.providerIndex) === capability.providerIndex &&
      provider?.authMode === "codex_account_gateway" &&
      provider.model === capability.model &&
      capability.providerKind ===
        reviewAgentExecutionProviderKind(
          snapshot.snapshotVersion === 3
            ? snapshot.agent
            : reviewer!.agentProfile,
        ) &&
      capability.extensionId === lifecycleVerificationContract.extensionId &&
      capability.descriptorDigest === lifecycleVerificationDescriptorDigest &&
      capability.executor === lifecycleVerificationContract.executor &&
      capability.modelTransport === "account_gateway" &&
      capability.maxDispatches === 2 &&
      capability.attemptBudget === 1,
    "lifecycle_verification_capability_invalid",
  );
  return { snapshot, capability, reviewer };
}

export function lifecycleVerificationCapabilityHash(
  capability: LifecycleVerificationCapabilityV1,
): string {
  return createHash("sha256").update(canonicalJson(capability)).digest("hex");
}
export const lifecycleVerificationOutputSchemaHash = createHash("sha256")
  .update(
    canonicalJson({
      extensionId: lifecycleVerificationContract.extensionId,
      outputSchemaVersion: lifecycleVerificationContract.outputSchemaVersion,
    }),
  )
  .digest("hex");

function enabled(authorization: Authorization): boolean {
  const snapshot = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  requireFact(
    !snapshot?.lifecycleVerificationUnavailableReason,
    "lifecycle_verification_unavailable",
  );
  return !!snapshot?.lifecycleVerificationCapability;
}

export function assertLifecycleVerificationWorkSlots(
  authorization: Authorization,
  slots: readonly Slot[],
): void {
  const verification = slots.filter(
    (slot) => slot.taskKind === ReviewTaskKind.LifecycleRevalidation,
  );
  if (!verification.length || !enabled(authorization)) return;
  const { capability, reviewer } = primary(authorization);
  requireFact(
    verification.length <= capability.maxDispatches,
    "lifecycle_verification_slot_count_invalid",
  );
  for (const slot of verification)
    requireFact(
      !slot.required &&
        slot.attemptBudget === 1 &&
        slot.providerKind === capability.providerKind &&
        (!reviewer ||
          slot.providerVoteIdentityHash ===
            reviewer.providerVoteIdentityHash) &&
        authorization.providerVoteLanes.some(
          (lane) =>
            String(lane.providerKind) === slot.providerKind &&
            lane.providerVoteIdentityHash === slot.providerVoteIdentityHash,
        ),
      "lifecycle_verification_slot_authority_invalid",
    );
}

/** The new executor owns only this prompt-only purpose. Old profiles retain
 * their historical lifecycle manifests; only a captured profile enables it. */
export function assertLifecycleVerificationManifest(
  authorization: Authorization,
  slot: Slot,
  manifest: ProviderInvocationManifest,
): void {
  if (
    slot.taskKind !== ReviewTaskKind.LifecycleRevalidation ||
    !enabled(authorization)
  )
    return;
  assertLifecycleVerificationWorkSlots(authorization, [slot]);
  const { capability } = primary(authorization);
  requireFact(
    manifest.taskKindSet.length === 1 &&
      String(manifest.taskKindSet[0]) ===
        ReviewTaskKind.LifecycleRevalidation &&
      String(manifest.providerKind) === slot.providerKind &&
      manifest.requestedModel === capability.model &&
      manifest.providerPolicyVersion ===
        lifecycleVerificationContract.policyVersion &&
      manifest.providerCapabilityHash ===
        lifecycleVerificationCapabilityHash(capability) &&
      manifest.outputSchemaHash === lifecycleVerificationOutputSchemaHash &&
      manifest.executionProfile ===
        ProviderExecutionProfile.PromptOnlyEnvelopeV1 &&
      manifest.lifecycleTargetSetHash !== null &&
      manifest.liveLifecycleStateHash !== null,
    "lifecycle_verification_manifest_invalid",
  );
}

export function assertLifecycleVerificationObservation(
  authorization: Authorization,
  slot: Slot,
  manifest: ProviderInvocationManifest,
  payload: unknown,
): void {
  if (
    slot.taskKind !== ReviewTaskKind.LifecycleRevalidation ||
    !enabled(authorization)
  )
    return;
  assertLifecycleVerificationManifest(authorization, slot, manifest);
  requireFact(
    record(payload) &&
      Array.isArray(payload.normalizedFindings) &&
      payload.normalizedFindings.length === 0 &&
      payload.investigationCertificate === undefined &&
      payload.generatedPrDescription === undefined,
    "lifecycle_verification_observation_invalid",
  );
}

export function assertLifecycleVerificationAssignmentManifest(
  authorization: Authorization,
  slots: readonly Slot[],
  assignmentManifest: unknown,
): void {
  const verification = slots.filter(
    (slot) => slot.taskKind === ReviewTaskKind.LifecycleRevalidation,
  );
  if (!verification.length || !enabled(authorization)) return;
  assertLifecycleVerificationWorkSlots(authorization, slots);
  const { capability } = primary(authorization);
  requireFact(
    record(assignmentManifest) &&
      assignmentManifest.manifestVersion === 2 &&
      record(assignmentManifest.lifecyclePlan),
    "lifecycle_verification_plan_required",
  );
  const plan = assignmentManifest.lifecyclePlan;
  const roster = plan.participantRoster;
  const participant = Array.isArray(roster) ? roster[0] : undefined;
  requireFact(
    plan.version === 1 &&
      plan.capabilityHash === lifecycleVerificationCapabilityHash(capability) &&
      plan.descriptorDigest === lifecycleVerificationDescriptorDigest &&
      Array.isArray(roster) &&
      roster.length === 1 &&
      record(participant) &&
      verification.every(
        (slot) =>
          slot.providerVoteIdentityHash ===
          participant.providerVoteIdentityHash,
      ),
    "lifecycle_verification_roster_mismatch",
  );
  requireFact(
    Array.isArray(plan.targets) &&
      plan.targets.length <= 8 &&
      Array.isArray(plan.assignments) &&
      plan.assignments.length === verification.length &&
      plan.assignments.length <= 2,
    "lifecycle_verification_plan_assignments_invalid",
  );
  const targets = new Set<string>();
  for (const target of plan.targets) {
    requireFact(
      record(target) &&
        typeof target.targetId === "string" &&
        !targets.has(target.targetId),
      "lifecycle_verification_plan_target_invalid",
    );
    targets.add(target.targetId);
  }
  const assignedTargets = new Set<string>();
  const assignedSlots = new Set<string>();
  for (const assignment of plan.assignments) {
    requireFact(
      record(assignment) &&
        typeof assignment.workSlotId === "string" &&
        verification.some(
          (slot) => slot.workSlotId === assignment.workSlotId,
        ) &&
        !assignedSlots.has(assignment.workSlotId) &&
        Array.isArray(assignment.targetIds) &&
        assignment.targetIds.length > 0 &&
        assignment.targetIds.length <=
          Math.min(
            4,
            Math.floor(
              capability.maxOutputTokens /
                lifecycleVerificationContract.minOutputTokensPerTarget,
            ),
          ) &&
        [
          assignment.packetHash,
          assignment.lifecycleTargetSetHash,
          assignment.liveLifecycleStateHash,
        ].every(
          (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
        ),
      "lifecycle_verification_plan_assignment_invalid",
    );
    assignedSlots.add(assignment.workSlotId);
    for (const targetId of assignment.targetIds) {
      requireFact(
        typeof targetId === "string" &&
          targets.has(targetId) &&
          !assignedTargets.has(targetId),
        "lifecycle_verification_plan_target_assignment_invalid",
      );
      assignedTargets.add(targetId);
    }
    const targetIds = assignment.targetIds;
    const witnesses = plan.targets
      .filter((target) => record(target) && targetIds.includes(target.targetId))
      .sort((left, right) => {
        const a = String(Reflect.get(left, "targetId"));
        const b = String(Reflect.get(right, "targetId"));
        return a < b ? -1 : a > b ? 1 : 0;
      });
    requireFact(
      createHash("sha256").update(canonicalJson(witnesses)).digest("hex") ===
        assignment.lifecycleTargetSetHash,
      "lifecycle_verification_plan_target_hash_invalid",
    );
    requireFact(
      Array.isArray(assignmentManifest.assignments) &&
        assignmentManifest.assignments.some(
          (entry) =>
            record(entry) &&
            entry.workSlotId === assignment.workSlotId &&
            Array.isArray(entry.paths) &&
            entry.paths.length === 0,
        ),
      "lifecycle_verification_is_not_discovery_coverage",
    );
  }
  requireFact(
    assignedTargets.size === targets.size,
    "lifecycle_verification_plan_target_accounting_invalid",
  );
}

export function assertLifecycleVerificationPreparedPlan(
  authorization: Authorization,
  assignmentManifest: unknown,
  slot: Slot,
  manifest: ProviderInvocationManifest,
): void {
  if (
    slot.taskKind !== ReviewTaskKind.LifecycleRevalidation ||
    !enabled(authorization)
  )
    return;
  assertLifecycleVerificationManifest(authorization, slot, manifest);
  requireFact(
    record(assignmentManifest) && record(assignmentManifest.lifecyclePlan),
    "lifecycle_verification_plan_required",
  );
  const plan = assignmentManifest.lifecyclePlan;
  const { capability } = primary(authorization);
  requireFact(
    assignmentManifest.manifestVersion === 2 &&
      plan.capabilityHash === lifecycleVerificationCapabilityHash(capability) &&
      plan.descriptorDigest === lifecycleVerificationDescriptorDigest &&
      Array.isArray(plan.participantRoster) &&
      plan.participantRoster.length === 1 &&
      record(plan.participantRoster[0]) &&
      plan.participantRoster[0].providerVoteIdentityHash ===
        slot.providerVoteIdentityHash,
    "lifecycle_verification_roster_mismatch",
  );
  requireFact(
    Array.isArray(plan.assignments) &&
      plan.assignments.some(
        (entry) =>
          record(entry) &&
          entry.workSlotId === slot.workSlotId &&
          Array.isArray(entry.targetIds) &&
          entry.targetIds.length > 0 &&
          entry.targetIds.length <=
            Math.min(
              4,
              Math.floor(
                capability.maxOutputTokens /
                  lifecycleVerificationContract.minOutputTokensPerTarget,
              ),
            ) &&
          entry.packetHash === manifest.contextManifestHash &&
          entry.lifecycleTargetSetHash === manifest.lifecycleTargetSetHash &&
          entry.liveLifecycleStateHash === manifest.liveLifecycleStateHash,
      ),
    "lifecycle_verification_plan_mismatch",
  );
}

/** Reuse callers pass the persisted ORIGINAL source authorization and lease.
 * Missing/pruned proof makes reuse ineligible; it never reopens dispatch. */
export async function assertReviewRunCompanionDispatchEvidence(
  input: Readonly<{
    prisma: Pick<PrismaClient, "reviewRunCompanionDispatchV1">;
    authorization: Authorization &
      Pick<ReviewRunAuthorization, "authorizationId">;
    executionId: string;
    workSlotId: string;
    leaseId: string;
    fencingToken: bigint;
    preparedManifestKey: string;
    providerRequestEnvelopeHash: string;
    role: "lifecycle_verification" | "pr_description";
  }>,
): Promise<void> {
  if (
    input.role === "pr_description" &&
    !parseReviewRunRuntimeSnapshot(
      input.authorization.runtimeSnapshotCanonicalJson,
    )?.lifecycleVerificationCapability
  )
    return;
  if (!enabled(input.authorization)) return;
  const row = await input.prisma.reviewRunCompanionDispatchV1.findFirst({
    where: {
      authorizationId: input.authorization.authorizationId,
      executionId: input.executionId,
      workSlotId: input.workSlotId,
      leaseId: input.leaseId,
      fencingToken: input.fencingToken,
      preparedManifestKey: input.preparedManifestKey,
      providerRequestEnvelopeHash: input.providerRequestEnvelopeHash,
      attemptOrdinal: 1,
      role: input.role,
      state: "completed",
    },
  });
  requireFact(row, `${input.role}_completed_dispatch_required`);
}

export async function assertLifecycleVerificationDispatchEvidence(
  input: Omit<
    Parameters<typeof assertReviewRunCompanionDispatchEvidence>[0],
    "role"
  >,
): Promise<void> {
  await assertReviewRunCompanionDispatchEvidence({
    ...input,
    role: "lifecycle_verification",
  });
}

/** Production composition supplies the existing verified lease authority and
 * selection locks; SQL reservations never depend on a caller role string. */
export function createReviewRunCompanionDispatchAdmission(
  input: Readonly<{
    prisma: PrismaClient;
    verifyLease(token: string, now: Date): Promise<CompanionLeaseAuthority>;
    lockSelection(
      transaction: Prisma.TransactionClient,
      authorization: ReviewRunAuthorization,
    ): Promise<boolean>;
  }>,
) {
  const repository = new PrismaReviewRunCompanionDispatchRepository(
    input.prisma,
    {
      lockSelection: input.lockSelection,
      validateManifest(authorization, stored, raw, assignmentManifest, timing) {
        try {
          const { capability } = primary(authorization);
          requireFact(
            timing.executionDeadlineAt.getTime() - timing.now.getTime() >=
              capability.deadlineMs,
            "verification_deadline",
          );
          const slot = stored as Slot;
          const manifest = normalizeProviderInvocationManifest(
            raw as ProviderInvocationManifest,
          );
          if (slot.taskKind === ReviewTaskKind.LifecycleRevalidation) {
            assertLifecycleVerificationPreparedPlan(
              authorization,
              assignmentManifest,
              slot,
              manifest,
            );
          } else {
            // New profile descriptions share finite scoped admission; legacy routes
            // continue without this additional capability.
            assertPrDescriptionManifest(
              authorization,
              slot as ReviewWorkSlotPlan,
              manifest,
            );
          }
        } catch (error) {
          throw new ReviewRunCompanionDispatchFailure(
            error instanceof ReviewActionV2RouteFailure
              ? (error.issues[0] ?? "companion_manifest_invalid")
              : "companion_manifest_invalid",
          );
        }
      },
    },
  );
  return new ClaimReviewRunCompanionDispatch(repository, input.verifyLease);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
