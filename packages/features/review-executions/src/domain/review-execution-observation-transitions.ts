import {
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewObservationAttachmentKind,
  ReviewWorkSlotState,
  assertDate,
  assertIdentifier,
  assertSha256,
  scopeKey,
  type ReviewExecution,
  type ReviewExecutionObservationRef,
  type ReviewExecutionStream,
  type ReviewInvocationLease,
  type ReviewWorkSlot,
} from "./review-execution";
import {
  replaceExecutionSlot,
  isCurrentRunning,
  assertSameScope,
  leaseTermMatches,
} from "./review-execution-transition-invariants";

export enum ObservationAttachmentDecisionStatus {
  Attached = "attached",
  Restored = "restored",
  Conflict = "conflict",
  NotRunnable = "not_runnable",
  StaleLease = "stale_lease",
  Ineligible = "ineligible",
  ReportWindowExpired = "report_window_expired",
}

export type ObservationAttachmentDecision =
  | {
      readonly status: ObservationAttachmentDecisionStatus.Attached;
      readonly execution: ReviewExecution;
      readonly observationRef: ReviewExecutionObservationRef;
      readonly leases: readonly ReviewInvocationLease[];
    }
  | {
      readonly status: ObservationAttachmentDecisionStatus.Restored;
      readonly observationRef: ReviewExecutionObservationRef;
    }
  | {
      readonly status:
        | ObservationAttachmentDecisionStatus.Conflict
        | ObservationAttachmentDecisionStatus.NotRunnable
        | ObservationAttachmentDecisionStatus.StaleLease
        | ObservationAttachmentDecisionStatus.Ineligible
        | ObservationAttachmentDecisionStatus.ReportWindowExpired;
    };

export type ObservationFacts = {
  readonly observationRefId: string;
  readonly observationId: string;
  readonly executionId: string;
  readonly workSlotId: string;
  readonly providerInvocationKey: string;
  readonly providerVoteIdentityHash: string;
  readonly payloadHash: string;
  readonly byteCount: number;
  readonly findingCount: number;
  readonly eligibilityPolicyVersion: string;
  readonly now: Date;
};

type ObservationAttachmentIdentity = {
  readonly sourceExecutionId: string;
  readonly attachmentKind: ReviewObservationAttachmentKind;
  readonly reuseSafetyDecisionHash: string | null;
  readonly sourceLeaseId: string | null;
  readonly sourceFencingToken: bigint | null;
};

export function decideFreshObservationAttachment(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly slot: ReviewWorkSlot;
  readonly existingRefForSlot: ReviewExecutionObservationRef | null;
  readonly existingRefByIdentity: ReviewExecutionObservationRef | null;
  readonly lease: ReviewInvocationLease | null;
  readonly term: {
    readonly leaseId: string;
    readonly ownerIdHash: string;
    readonly leaseCapabilityId: string;
    readonly fencingToken: bigint;
  };
  readonly facts: ObservationFacts;
}): ObservationAttachmentDecision {
  assertObservationFacts(input.facts);
  assertObservationTarget(input.stream, input.execution, input.slot);
  const restored = decideExistingObservation(
    input.existingRefForSlot,
    input.existingRefByIdentity,
    input.facts,
    {
      sourceExecutionId: input.facts.executionId,
      attachmentKind: ReviewObservationAttachmentKind.FreshLease,
      reuseSafetyDecisionHash: null,
      sourceLeaseId: input.term.leaseId,
      sourceFencingToken: input.term.fencingToken,
    },
  );
  if (restored !== null) return restored;
  if (!isCurrentRunning(input.stream, input.execution)) {
    return { status: ObservationAttachmentDecisionStatus.NotRunnable };
  }
  const lease = input.lease;
  if (
    lease === null ||
    lease.leaseId !== input.term.leaseId ||
    !leaseTermMatches(lease, input.term) ||
    lease.state !== ReviewInvocationLeaseState.Active ||
    lease.expiresAt <= input.facts.now ||
    lease.executionId !== input.facts.executionId ||
    scopeKey(lease) !== scopeKey(input.execution) ||
    lease.workSlotId !== input.facts.workSlotId ||
    lease.providerInvocationKey !== input.facts.providerInvocationKey ||
    input.slot.activeLeaseId !== lease.leaseId
  ) {
    return { status: ObservationAttachmentDecisionStatus.StaleLease };
  }
  const ref = buildObservationRef({
    facts: input.facts,
    sourceExecutionId: input.facts.executionId,
    attachmentKind: ReviewObservationAttachmentKind.FreshLease,
    reuseSafetyDecisionHash: null,
    sourceLeaseId: lease.leaseId,
    sourceFencingToken: lease.fencingToken,
  });
  return attachedObservationDecision(
    input.execution,
    input.slot,
    ref,
    [{ ...lease, state: ReviewInvocationLeaseState.Released }],
    input.facts.now,
  );
}

export function decideReusableObservationAttachment(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly slot: ReviewWorkSlot;
  readonly existingRefForSlot: ReviewExecutionObservationRef | null;
  readonly existingRefByIdentity: ReviewExecutionObservationRef | null;
  readonly sourceExecutionId: string;
  readonly attachmentKind:
    | ReviewObservationAttachmentKind.ExactRevisionReuse
    | ReviewObservationAttachmentKind.PromptOnlyCrossRevisionReuse
    | ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse;
  readonly reuseSafetyDecisionHash: string;
  readonly facts: ObservationFacts;
}): ObservationAttachmentDecision {
  assertObservationFacts(input.facts);
  assertObservationTarget(input.stream, input.execution, input.slot);
  assertSha256(input.reuseSafetyDecisionHash, "reuse_safety_decision_hash");
  const restored = decideExistingObservation(
    input.existingRefForSlot,
    input.existingRefByIdentity,
    input.facts,
    {
      sourceExecutionId: input.sourceExecutionId,
      attachmentKind: input.attachmentKind,
      reuseSafetyDecisionHash: input.reuseSafetyDecisionHash,
      sourceLeaseId: null,
      sourceFencingToken: null,
    },
  );
  if (restored !== null) return restored;
  if (
    input.sourceExecutionId === input.execution.executionId ||
    !isCurrentRunning(input.stream, input.execution) ||
    input.slot.activeLeaseId !== null ||
    input.slot.providerVoteIdentityHash !== input.facts.providerVoteIdentityHash
  ) {
    return { status: ObservationAttachmentDecisionStatus.Ineligible };
  }
  const ref = buildObservationRef({
    facts: input.facts,
    sourceExecutionId: input.sourceExecutionId,
    attachmentKind: input.attachmentKind,
    reuseSafetyDecisionHash: input.reuseSafetyDecisionHash,
    sourceLeaseId: null,
    sourceFencingToken: null,
  });
  return attachedObservationDecision(
    input.execution,
    input.slot,
    ref,
    [],
    input.facts.now,
  );
}

export function decideObservationAdoption(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly slot: ReviewWorkSlot;
  readonly existingRefForSlot: ReviewExecutionObservationRef | null;
  readonly existingRefByIdentity: ReviewExecutionObservationRef | null;
  readonly existingAdoptionLease: ReviewInvocationLease | null;
  readonly sourceLease: ReviewInvocationLease | null;
  readonly expectedStreamVersion: bigint;
  readonly expectedExecutionVersion: bigint;
  readonly sourceLeaseId: string;
  readonly sourceFencingToken: bigint;
  readonly adoptionLeaseId: string;
  readonly adoptionAcquireRequestIdHash: string;
  readonly adoptionAcquireRequestHash: string;
  readonly ownerIdHash: string;
  readonly leaseCapabilityId: string;
  readonly capabilitySigningKeyId: string;
  readonly leaseSafetyDecisionHash: string;
  readonly fencingToken: bigint;
  readonly retainUntil: Date;
  readonly facts: ObservationFacts;
}): ObservationAttachmentDecision {
  assertObservationFacts(input.facts);
  assertObservationTarget(input.stream, input.execution, input.slot);
  const restored = decideExistingObservation(
    input.existingRefForSlot,
    input.existingRefByIdentity,
    input.facts,
    {
      sourceExecutionId: input.facts.executionId,
      attachmentKind: ReviewObservationAttachmentKind.ObservationAdoption,
      reuseSafetyDecisionHash: null,
      sourceLeaseId: input.sourceLeaseId,
      sourceFencingToken: input.sourceFencingToken,
    },
  );
  const existingLease = input.existingAdoptionLease;
  if (existingLease !== null || restored !== null) {
    // Concurrent retries can reach the store before the API sees the first ref.
    // Restore the persisted intent, never newly prepared capability identities.
    if (
      restored?.status !== ObservationAttachmentDecisionStatus.Restored ||
      existingLease === null ||
      existingLease.leaseId !== input.adoptionLeaseId ||
      existingLease.purpose !==
        ReviewInvocationLeasePurpose.ObservationAdoption ||
      existingLease.state !== ReviewInvocationLeaseState.Released ||
      scopeKey(existingLease) !== scopeKey(input.execution) ||
      existingLease.executionId !== input.execution.executionId ||
      existingLease.executionGeneration !== input.execution.generation ||
      existingLease.authorizationId !== input.execution.authorizationId ||
      existingLease.producerReleaseId !== input.execution.producerReleaseId ||
      existingLease.reviewRevisionHash !==
        input.execution.revision.reviewRevisionHash ||
      existingLease.mutationEpoch !== input.execution.mutationEpoch ||
      existingLease.workSlotId !== input.slot.workSlotId ||
      existingLease.sourceObservationId !== input.facts.observationId ||
      existingLease.providerInvocationKey !==
        input.facts.providerInvocationKey ||
      existingLease.providerVoteIdentityHash !==
        input.facts.providerVoteIdentityHash ||
      existingLease.ownerIdHash !== input.ownerIdHash ||
      existingLease.acquireRequestIdHash !==
        input.adoptionAcquireRequestIdHash ||
      existingLease.acquireRequestHash !== input.adoptionAcquireRequestHash
    ) {
      return { status: ObservationAttachmentDecisionStatus.Conflict };
    }
    return restored;
  }
  const source = input.sourceLease;
  if (
    !isCurrentRunning(input.stream, input.execution) ||
    input.stream.version !== input.expectedStreamVersion ||
    input.execution.version !== input.expectedExecutionVersion ||
    source === null ||
    source.leaseId !== input.sourceLeaseId ||
    source.fencingToken !== input.sourceFencingToken ||
    scopeKey(source) !== scopeKey(input.execution) ||
    source.executionId !== input.execution.executionId ||
    source.workSlotId !== input.slot.workSlotId ||
    source.providerInvocationKey !== input.facts.providerInvocationKey ||
    source.purpose !== ReviewInvocationLeasePurpose.ProviderExecution ||
    (input.slot.activeLeaseId !== null &&
      input.slot.activeLeaseId !== source.leaseId) ||
    input.slot.acceptedObservationRefId !== null
  ) {
    return { status: ObservationAttachmentDecisionStatus.Ineligible };
  }
  if (source.resultReportUntil < input.facts.now) {
    return { status: ObservationAttachmentDecisionStatus.ReportWindowExpired };
  }
  const adoptionLease: ReviewInvocationLease = {
    workspaceId: input.execution.workspaceId,
    repositoryConnectionId: input.execution.repositoryConnectionId,
    scmRepositoryIdentityId: input.execution.scmRepositoryIdentityId,
    pullRequestNumber: input.execution.pullRequestNumber,
    providerInvocationKey: input.facts.providerInvocationKey,
    preparedManifestCanonicalJson: null,
    preparedManifestKey: null,
    providerVoteIdentityHash: input.facts.providerVoteIdentityHash,
    workSlotId: input.slot.workSlotId,
    leaseId: input.adoptionLeaseId,
    purpose: ReviewInvocationLeasePurpose.ObservationAdoption,
    authorizationId: input.execution.authorizationId,
    producerReleaseId: input.execution.producerReleaseId,
    reviewRevisionHash: input.execution.revision.reviewRevisionHash,
    mutationEpoch: input.execution.mutationEpoch,
    leaseSafetyDecisionHash: input.leaseSafetyDecisionHash,
    attemptId: null,
    sourceObservationId: input.facts.observationId,
    attemptOrdinal: Math.max(0, input.slot.nextAttemptOrdinal - 1),
    acquireRequestIdHash: input.adoptionAcquireRequestIdHash,
    acquireRequestHash: input.adoptionAcquireRequestHash,
    lastRenewRequestIdHash: null,
    lastRenewRequestHash: null,
    ownerIdHash: input.ownerIdHash,
    leaseCapabilityId: input.leaseCapabilityId,
    capabilitySigningKeyId: input.capabilitySigningKeyId,
    fencingToken: input.fencingToken,
    executionId: input.execution.executionId,
    executionGeneration: input.execution.generation,
    state: ReviewInvocationLeaseState.Released,
    acquiredAt: new Date(input.facts.now),
    renewedAt: new Date(input.facts.now),
    expiresAt: new Date(input.facts.now),
    resultReportUntil: new Date(input.facts.now),
    retainUntil: new Date(input.retainUntil),
  };
  const ref = buildObservationRef({
    facts: input.facts,
    sourceExecutionId: input.execution.executionId,
    attachmentKind: ReviewObservationAttachmentKind.ObservationAdoption,
    reuseSafetyDecisionHash: null,
    sourceLeaseId: source.leaseId,
    sourceFencingToken: source.fencingToken,
  });
  return attachedObservationDecision(
    input.execution,
    input.slot,
    ref,
    [
      ...(source.state === ReviewInvocationLeaseState.Active
        ? [
            {
              ...source,
              state:
                source.expiresAt <= input.facts.now
                  ? ReviewInvocationLeaseState.Expired
                  : ReviewInvocationLeaseState.Released,
            },
          ]
        : []),
      adoptionLease,
    ],
    input.facts.now,
  );
}

function attachedObservationDecision(
  execution: ReviewExecution,
  slot: ReviewWorkSlot,
  ref: ReviewExecutionObservationRef,
  leases: readonly ReviewInvocationLease[],
  now: Date,
): ObservationAttachmentDecision {
  return {
    status: ObservationAttachmentDecisionStatus.Attached,
    observationRef: ref,
    leases,
    execution: replaceExecutionSlot(
      execution,
      {
        ...slot,
        state: ReviewWorkSlotState.Satisfied,
        activeLeaseId: null,
        acceptedObservationRefId: ref.observationRefId,
      },
      now,
    ),
  };
}

function decideExistingObservation(
  existingForSlot: ReviewExecutionObservationRef | null,
  existingByIdentity: ReviewExecutionObservationRef | null,
  facts: ObservationFacts,
  identity: ObservationAttachmentIdentity,
): ObservationAttachmentDecision | null {
  if (existingForSlot === null) {
    return existingByIdentity === null
      ? null
      : { status: ObservationAttachmentDecisionStatus.Conflict };
  }
  return existingForSlot.observationRefId === facts.observationRefId &&
    existingForSlot.observationId === facts.observationId &&
    existingForSlot.executionId === facts.executionId &&
    existingForSlot.workSlotId === facts.workSlotId &&
    existingForSlot.providerInvocationKey === facts.providerInvocationKey &&
    existingForSlot.providerVoteIdentityHash ===
      facts.providerVoteIdentityHash &&
    existingForSlot.payloadHash === facts.payloadHash &&
    existingForSlot.byteCount === facts.byteCount &&
    existingForSlot.findingCount === facts.findingCount &&
    existingForSlot.eligibilityPolicyVersion ===
      facts.eligibilityPolicyVersion &&
    existingForSlot.sourceExecutionId === identity.sourceExecutionId &&
    existingForSlot.attachmentKind === identity.attachmentKind &&
    existingForSlot.reuseSafetyDecisionHash ===
      identity.reuseSafetyDecisionHash &&
    existingForSlot.sourceLeaseId === identity.sourceLeaseId &&
    existingForSlot.sourceFencingToken === identity.sourceFencingToken
    ? {
        status: ObservationAttachmentDecisionStatus.Restored,
        observationRef: existingForSlot,
      }
    : { status: ObservationAttachmentDecisionStatus.Conflict };
}

function buildObservationRef(input: {
  readonly facts: ObservationFacts;
  readonly sourceExecutionId: string;
  readonly attachmentKind: ReviewObservationAttachmentKind;
  readonly reuseSafetyDecisionHash: string | null;
  readonly sourceLeaseId: string | null;
  readonly sourceFencingToken: bigint | null;
}): ReviewExecutionObservationRef {
  return {
    observationRefId: input.facts.observationRefId,
    executionId: input.facts.executionId,
    workSlotId: input.facts.workSlotId,
    providerInvocationKey: input.facts.providerInvocationKey,
    observationId: input.facts.observationId,
    providerVoteIdentityHash: input.facts.providerVoteIdentityHash,
    attachmentKind: input.attachmentKind,
    eligibilityPolicyVersion: input.facts.eligibilityPolicyVersion,
    reuseSafetyDecisionHash: input.reuseSafetyDecisionHash,
    sourceExecutionId: input.sourceExecutionId,
    sourceLeaseId: input.sourceLeaseId,
    sourceFencingToken: input.sourceFencingToken,
    payloadHash: input.facts.payloadHash,
    byteCount: input.facts.byteCount,
    findingCount: input.facts.findingCount,
    attachedAt: new Date(input.facts.now),
  };
}

function assertObservationTarget(
  stream: ReviewExecutionStream,
  execution: ReviewExecution,
  slot: ReviewWorkSlot,
): void {
  assertSameScope(stream, execution, "observation_execution");
  const aggregateSlot = execution.workSlots.find(
    (candidate) => candidate.workSlotId === slot.workSlotId,
  );
  if (aggregateSlot === undefined || !workSlotsEqual(aggregateSlot, slot)) {
    throw new Error("review_execution_observation_slot_not_in_aggregate");
  }
}

function workSlotsEqual(left: ReviewWorkSlot, right: ReviewWorkSlot): boolean {
  return (
    left.workSlotId === right.workSlotId &&
    left.taskKind === right.taskKind &&
    left.providerKind === right.providerKind &&
    left.providerVoteIdentityHash === right.providerVoteIdentityHash &&
    left.shardKey === right.shardKey &&
    left.required === right.required &&
    left.attemptBudget === right.attemptBudget &&
    left.retryPolicyVersion === right.retryPolicyVersion &&
    left.state === right.state &&
    left.activeLeaseId === right.activeLeaseId &&
    left.acceptedObservationRefId === right.acceptedObservationRefId &&
    left.nextAttemptOrdinal === right.nextAttemptOrdinal
  );
}

function assertObservationFacts(facts: ObservationFacts): void {
  assertIdentifier(facts.observationRefId, "observation_ref_id");
  assertIdentifier(facts.observationId, "observation_id");
  assertSha256(facts.providerInvocationKey, "provider_invocation_key");
  assertSha256(facts.providerVoteIdentityHash, "provider_vote_identity_hash");
  assertSha256(facts.payloadHash, "payload_hash");
  assertIdentifier(
    facts.eligibilityPolicyVersion,
    "eligibility_policy_version",
  );
  if (!Number.isSafeInteger(facts.byteCount) || facts.byteCount < 0) {
    throw new Error("review_execution_invalid_observation_byte_count");
  }
  if (!Number.isSafeInteger(facts.findingCount) || facts.findingCount < 0) {
    throw new Error("review_execution_invalid_observation_finding_count");
  }
  assertDate(facts.now, "observation_attached_at");
}
