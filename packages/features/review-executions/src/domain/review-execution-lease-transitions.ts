import {
  ReviewExecutionState,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewWorkSlotState,
  assertDate,
  assertIdentifier,
  assertReviewExecutionLimits,
  assertReviewExecutionScope,
  assertSha256,
  scopeKey,
  type ReviewExecution,
  type ReviewExecutionLimits,
  type ReviewExecutionScope,
  type ReviewExecutionStream,
  type ReviewInvocationLease,
} from "./review-execution";
import {
  replaceExecutionSlot,
  assertSameScope,
  leaseTermMatches,
} from "./review-execution-transition-invariants";

export enum LeaseAcquireReplayDecisionStatus {
  Proceed = "proceed",
  Restored = "restored",
  IdempotencyConflict = "idempotency_conflict",
}

export type LeaseAcquireReplayDecision =
  | {
      readonly status: LeaseAcquireReplayDecisionStatus.Proceed;
    }
  | {
      readonly status: LeaseAcquireReplayDecisionStatus.Restored;
      readonly lease: ReviewInvocationLease;
    }
  | {
      readonly status: LeaseAcquireReplayDecisionStatus.IdempotencyConflict;
    };

export function decideLeaseAcquireReplay(input: {
  readonly existingByAcquireIdentity: ReviewInvocationLease | null;
  readonly scope: ReviewExecutionScope;
  readonly executionId: string;
  readonly acquireRequestIdHash: string;
  readonly acquireRequestHash: string;
  readonly ownerIdHash: string;
  readonly providerInvocationKey: string;
  readonly preparedManifestCanonicalJson: string | null;
  readonly preparedManifestKey: string | null;
  readonly providerVoteIdentityHash: string;
  readonly workSlotId: string;
  readonly purpose: ReviewInvocationLeasePurpose;
}): LeaseAcquireReplayDecision {
  assertReviewExecutionScope(input.scope);
  assertIdentifier(input.executionId, "execution_id");
  assertSha256(input.acquireRequestIdHash, "acquire_request_id_hash");
  assertSha256(input.acquireRequestHash, "acquire_request_hash");
  assertIdentifier(input.ownerIdHash, "owner_id_hash");
  assertSha256(input.providerInvocationKey, "provider_invocation_key");
  assertIdentifier(input.workSlotId, "work_slot_id");
  const lease = input.existingByAcquireIdentity;
  if (lease === null) {
    return { status: LeaseAcquireReplayDecisionStatus.Proceed };
  }
  return scopeKey(lease) === scopeKey(input.scope) &&
    lease.executionId === input.executionId &&
    lease.acquireRequestIdHash === input.acquireRequestIdHash &&
    lease.acquireRequestHash === input.acquireRequestHash &&
    lease.ownerIdHash === input.ownerIdHash &&
    lease.providerInvocationKey === input.providerInvocationKey &&
    lease.preparedManifestCanonicalJson ===
      input.preparedManifestCanonicalJson &&
    lease.preparedManifestKey === input.preparedManifestKey &&
    lease.providerVoteIdentityHash === input.providerVoteIdentityHash &&
    lease.workSlotId === input.workSlotId &&
    lease.purpose === input.purpose
    ? { status: LeaseAcquireReplayDecisionStatus.Restored, lease }
    : { status: LeaseAcquireReplayDecisionStatus.IdempotencyConflict };
}

export enum LeaseAcquireDecisionStatus {
  Acquired = "acquired",
  Busy = "busy",
  AttemptBudgetExhausted = "attempt_budget_exhausted",
  NotRunnable = "not_runnable",
  MissingSlot = "missing_slot",
}

export type LeaseAcquireDecision =
  | {
      readonly status: LeaseAcquireDecisionStatus.Acquired;
      readonly execution: ReviewExecution;
      readonly lease: ReviewInvocationLease;
      readonly expiredLease: ReviewInvocationLease | null;
    }
  | {
      readonly status: LeaseAcquireDecisionStatus.AttemptBudgetExhausted;
      readonly execution: ReviewExecution;
      readonly expiredLease: ReviewInvocationLease | null;
    }
  | {
      readonly status: LeaseAcquireDecisionStatus.Busy;
    }
  | {
      readonly status: LeaseAcquireDecisionStatus.NotRunnable;
    }
  | {
      readonly status: LeaseAcquireDecisionStatus.MissingSlot;
    };

export type LeaseAcquireTransitionInput = {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly activeLease: ReviewInvocationLease | null;
  readonly fencingToken: bigint;
  readonly scope: ReviewExecutionScope;
  readonly workSlotId: string;
  readonly purpose: ReviewInvocationLeasePurpose;
  readonly providerInvocationKey: string;
  readonly preparedManifestCanonicalJson: string | null;
  readonly preparedManifestKey: string | null;
  readonly providerVoteIdentityHash: string;
  readonly leaseId: string;
  readonly attemptId: string | null;
  readonly sourceObservationId: string | null;
  readonly acquireRequestIdHash: string;
  readonly acquireRequestHash: string;
  readonly ownerIdHash: string;
  readonly leaseCapabilityId: string;
  readonly capabilitySigningKeyId: string;
  readonly leaseSafetyDecisionHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
  readonly resultReportUntil: Date;
  readonly notAfter?: Date;
  readonly retainUntil: Date;
  readonly limits: ReviewExecutionLimits;
};

export function decideLeaseAcquire(
  input: LeaseAcquireTransitionInput,
): LeaseAcquireDecision {
  assertLeaseAcquireInput(input);
  assertSameScope(input.stream, input.execution, "lease_execution");
  assertSameScope(input.execution, input.scope, "lease_command");
  const notAfter = Math.min(
    input.execution.executionDeadlineAt.getTime(),
    input.notAfter?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  if (
    input.stream.activeExecutionId !== input.execution.executionId ||
    input.execution.state !== ReviewExecutionState.Running ||
    notAfter <= input.now.getTime()
  ) {
    return { status: LeaseAcquireDecisionStatus.NotRunnable };
  }
  const slot = input.execution.workSlots.find(
    (candidate) => candidate.workSlotId === input.workSlotId,
  );
  if (!slot) {
    return { status: LeaseAcquireDecisionStatus.MissingSlot };
  }
  if (slot.providerVoteIdentityHash !== input.providerVoteIdentityHash) {
    throw new Error("review_execution_provider_lane_identity_mismatch");
  }
  if (slot.state === ReviewWorkSlotState.Exhausted) {
    return {
      status: LeaseAcquireDecisionStatus.AttemptBudgetExhausted,
      execution: input.execution,
      expiredLease: null,
    };
  }
  if (
    slot.state === ReviewWorkSlotState.Satisfied ||
    slot.state === ReviewWorkSlotState.Cancelled
  ) {
    return { status: LeaseAcquireDecisionStatus.NotRunnable };
  }
  let currentSlot = slot;
  let expiredLease: ReviewInvocationLease | null = null;
  if (slot.activeLeaseId !== null) {
    const active = input.activeLease;
    if (!active || active.leaseId !== slot.activeLeaseId) {
      throw new Error("review_execution_active_lease_reference_corrupted");
    }
    if (
      active.executionId !== input.execution.executionId ||
      active.workSlotId !== slot.workSlotId ||
      scopeKey(active) !== scopeKey(input.execution)
    ) {
      throw new Error("review_execution_active_lease_aggregate_mismatch");
    }
    if (
      active.state === ReviewInvocationLeaseState.Active &&
      active.expiresAt > input.now
    ) {
      return { status: LeaseAcquireDecisionStatus.Busy };
    }
    expiredLease =
      active.state === ReviewInvocationLeaseState.Active
        ? { ...active, state: ReviewInvocationLeaseState.Expired }
        : null;
    currentSlot = { ...slot, activeLeaseId: null };
  }
  if (
    input.purpose === ReviewInvocationLeasePurpose.ProviderExecution &&
    currentSlot.nextAttemptOrdinal > currentSlot.attemptBudget
  ) {
    return {
      status: LeaseAcquireDecisionStatus.AttemptBudgetExhausted,
      execution: replaceExecutionSlot(
        input.execution,
        { ...currentSlot, state: ReviewWorkSlotState.Exhausted },
        input.now,
      ),
      expiredLease,
    };
  }
  const attemptOrdinal =
    input.purpose === ReviewInvocationLeasePurpose.ProviderExecution
      ? currentSlot.nextAttemptOrdinal
      : Math.max(0, currentSlot.nextAttemptOrdinal - 1);
  const lease: ReviewInvocationLease = {
    ...input.scope,
    providerInvocationKey: input.providerInvocationKey,
    preparedManifestCanonicalJson: input.preparedManifestCanonicalJson,
    preparedManifestKey: input.preparedManifestKey,
    providerVoteIdentityHash: input.providerVoteIdentityHash,
    workSlotId: input.workSlotId,
    leaseId: input.leaseId,
    purpose: input.purpose,
    authorizationId: input.execution.authorizationId,
    producerReleaseId: input.execution.producerReleaseId,
    reviewRevisionHash: input.execution.revision.reviewRevisionHash,
    mutationEpoch: input.execution.mutationEpoch,
    leaseSafetyDecisionHash: input.leaseSafetyDecisionHash,
    attemptId: input.attemptId,
    sourceObservationId: input.sourceObservationId,
    attemptOrdinal,
    acquireRequestIdHash: input.acquireRequestIdHash,
    acquireRequestHash: input.acquireRequestHash,
    lastRenewRequestIdHash: null,
    lastRenewRequestHash: null,
    ownerIdHash: input.ownerIdHash,
    leaseCapabilityId: input.leaseCapabilityId,
    capabilitySigningKeyId: input.capabilitySigningKeyId,
    fencingToken: input.fencingToken,
    executionId: input.execution.executionId,
    executionGeneration: input.execution.generation,
    state: ReviewInvocationLeaseState.Active,
    acquiredAt: new Date(input.now),
    renewedAt: new Date(input.now),
    expiresAt: new Date(Math.min(input.expiresAt.getTime(), notAfter)),
    resultReportUntil: new Date(
      Math.min(input.resultReportUntil.getTime(), notAfter),
    ),
    retainUntil: new Date(input.retainUntil),
  };
  return {
    status: LeaseAcquireDecisionStatus.Acquired,
    lease,
    expiredLease,
    execution: replaceExecutionSlot(
      input.execution,
      {
        ...currentSlot,
        state: ReviewWorkSlotState.Leased,
        activeLeaseId: lease.leaseId,
        nextAttemptOrdinal:
          input.purpose === ReviewInvocationLeasePurpose.ProviderExecution
            ? currentSlot.nextAttemptOrdinal + 1
            : currentSlot.nextAttemptOrdinal,
      },
      input.now,
    ),
  };
}

export enum LeaseTransitionDecisionStatus {
  Applied = "applied",
  Restored = "restored",
  StaleTerm = "stale_term",
  Expired = "expired",
  InvalidDeadline = "invalid_deadline",
  IdempotencyConflict = "idempotency_conflict",
}

export type LeaseTransitionDecision = {
  readonly status: LeaseTransitionDecisionStatus;
  readonly lease: ReviewInvocationLease;
  readonly execution: ReviewExecution | null;
};

export function decideLeaseRenewal(input: {
  readonly lease: ReviewInvocationLease;
  readonly execution: ReviewExecution | null;
  readonly ownerIdHash: string;
  readonly leaseCapabilityId: string;
  readonly fencingToken: bigint;
  readonly renewRequestIdHash: string;
  readonly renewRequestHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
  readonly resultReportUntil: Date;
  readonly limits: ReviewExecutionLimits;
}): LeaseTransitionDecision {
  assertDate(input.now, "now");
  assertDate(input.expiresAt, "lease_expires_at");
  assertDate(input.resultReportUntil, "result_report_until");
  assertSha256(input.renewRequestIdHash, "renew_request_id_hash");
  assertSha256(input.renewRequestHash, "renew_request_hash");
  assertReviewExecutionLimits(input.limits);
  assertLeaseExecutionRelation(input.lease, input.execution);
  if (!leaseTermMatches(input.lease, input)) {
    return unchangedLease(LeaseTransitionDecisionStatus.StaleTerm, input);
  }
  if (input.lease.lastRenewRequestIdHash === input.renewRequestIdHash) {
    return input.lease.lastRenewRequestHash === input.renewRequestHash
      ? unchangedLease(LeaseTransitionDecisionStatus.Restored, input)
      : unchangedLease(
          LeaseTransitionDecisionStatus.IdempotencyConflict,
          input,
        );
  }
  if (
    input.lease.state !== ReviewInvocationLeaseState.Active ||
    input.lease.expiresAt <= input.now
  ) {
    return expireLeaseDecision(input);
  }
  if (
    input.expiresAt < input.lease.expiresAt ||
    input.resultReportUntil < input.lease.resultReportUntil
  ) {
    return unchangedLease(LeaseTransitionDecisionStatus.InvalidDeadline, input);
  }
  if (
    input.lease.expiresAt.getTime() === input.expiresAt.getTime() &&
    input.lease.resultReportUntil.getTime() ===
      input.resultReportUntil.getTime()
  ) {
    return {
      status: LeaseTransitionDecisionStatus.Restored,
      lease: withRenewRequestIdentity(input.lease, input),
      execution: input.execution,
    };
  }
  if (!validLeaseDeadlines(input, input.limits)) {
    return unchangedLease(LeaseTransitionDecisionStatus.InvalidDeadline, input);
  }
  return {
    status: LeaseTransitionDecisionStatus.Applied,
    lease: {
      ...input.lease,
      ...renewRequestIdentity(input),
      renewedAt: new Date(input.now),
      expiresAt: new Date(input.expiresAt),
      resultReportUntil: new Date(input.resultReportUntil),
    },
    execution: input.execution,
  };
}

export function decideLeaseRelease(input: {
  readonly lease: ReviewInvocationLease;
  readonly execution: ReviewExecution | null;
  readonly ownerIdHash: string;
  readonly leaseCapabilityId: string;
  readonly fencingToken: bigint;
  readonly now: Date;
}): LeaseTransitionDecision {
  assertDate(input.now, "now");
  assertLeaseExecutionRelation(input.lease, input.execution);
  if (!leaseTermMatches(input.lease, input)) {
    return unchangedLease(LeaseTransitionDecisionStatus.StaleTerm, input);
  }
  if (input.lease.state === ReviewInvocationLeaseState.Released) {
    return unchangedLease(LeaseTransitionDecisionStatus.Restored, input);
  }
  if (
    input.lease.state === ReviewInvocationLeaseState.Active &&
    input.lease.expiresAt <= input.now
  ) {
    return expireLeaseDecision(input);
  }
  if (input.lease.state !== ReviewInvocationLeaseState.Active) {
    return unchangedLease(LeaseTransitionDecisionStatus.StaleTerm, input);
  }
  return {
    status: LeaseTransitionDecisionStatus.Applied,
    lease: { ...input.lease, state: ReviewInvocationLeaseState.Released },
    execution: clearLeaseFromExecution(input.execution, input.lease, input.now),
  };
}

function withRenewRequestIdentity(
  lease: ReviewInvocationLease,
  input: {
    readonly renewRequestIdHash: string;
    readonly renewRequestHash: string;
  },
): ReviewInvocationLease {
  return { ...lease, ...renewRequestIdentity(input) };
}

function renewRequestIdentity(input: {
  readonly renewRequestIdHash: string;
  readonly renewRequestHash: string;
}) {
  return {
    lastRenewRequestIdHash: input.renewRequestIdHash,
    lastRenewRequestHash: input.renewRequestHash,
  } as const;
}

function expireLeaseDecision(input: {
  readonly lease: ReviewInvocationLease;
  readonly execution: ReviewExecution | null;
  readonly now: Date;
}): LeaseTransitionDecision {
  return {
    status: LeaseTransitionDecisionStatus.Expired,
    lease:
      input.lease.state === ReviewInvocationLeaseState.Active
        ? { ...input.lease, state: ReviewInvocationLeaseState.Expired }
        : input.lease,
    execution: clearLeaseFromExecution(input.execution, input.lease, input.now),
  };
}

export function decideLeaseExpiry(input: {
  readonly lease: ReviewInvocationLease;
  readonly execution: ReviewExecution | null;
  readonly now: Date;
}): LeaseTransitionDecision {
  assertDate(input.now, "lease_expiry_now");
  return expireLeaseDecision(input);
}

function unchangedLease(
  status: LeaseTransitionDecisionStatus,
  input: {
    readonly lease: ReviewInvocationLease;
    readonly execution: ReviewExecution | null;
  },
): LeaseTransitionDecision {
  return { status, lease: input.lease, execution: input.execution };
}

function clearLeaseFromExecution(
  execution: ReviewExecution | null,
  lease: ReviewInvocationLease,
  now: Date,
): ReviewExecution | null {
  if (execution === null) return null;
  const slot = execution.workSlots.find(
    (candidate) => candidate.workSlotId === lease.workSlotId,
  );
  if (!slot || slot.activeLeaseId !== lease.leaseId) return execution;
  return replaceExecutionSlot(
    execution,
    {
      ...slot,
      activeLeaseId: null,
      state:
        slot.nextAttemptOrdinal > slot.attemptBudget
          ? ReviewWorkSlotState.Exhausted
          : ReviewWorkSlotState.Pending,
    },
    now,
  );
}

function assertLeaseExecutionRelation(
  lease: ReviewInvocationLease,
  execution: ReviewExecution | null,
): void {
  if (
    execution !== null &&
    (lease.executionId !== execution.executionId ||
      scopeKey(lease) !== scopeKey(execution))
  ) {
    throw new Error("review_execution_lease_aggregate_mismatch");
  }
}

function assertLeaseAcquireInput(input: LeaseAcquireTransitionInput): void {
  assertReviewExecutionScope(input.scope);
  if (input.notAfter !== undefined)
    assertDate(input.notAfter, "lease_not_after");
  for (const [value, field] of [
    [input.workSlotId, "work_slot_id"],
    [input.leaseId, "lease_id"],
    [input.ownerIdHash, "owner_id_hash"],
    [input.leaseCapabilityId, "lease_capability_id"],
    [input.capabilitySigningKeyId, "capability_signing_key_id"],
  ] as const) {
    assertIdentifier(value, field);
  }
  for (const [value, field] of [
    [input.providerInvocationKey, "provider_invocation_key"],
    [input.providerVoteIdentityHash, "provider_vote_identity_hash"],
    [input.acquireRequestIdHash, "acquire_request_id_hash"],
    [input.acquireRequestHash, "acquire_request_hash"],
    [input.leaseSafetyDecisionHash, "lease_safety_decision_hash"],
  ] as const) {
    assertSha256(value, field);
  }
  if (
    input.purpose === ReviewInvocationLeasePurpose.ProviderExecution
      ? input.attemptId === null ||
        input.sourceObservationId !== null ||
        input.preparedManifestCanonicalJson === null ||
        input.preparedManifestKey === null
      : input.sourceObservationId === null ||
        input.attemptId !== null ||
        input.preparedManifestCanonicalJson !== null ||
        input.preparedManifestKey !== null
  ) {
    throw new Error("review_execution_invalid_lease_purpose_fields");
  }
  if (input.attemptId) assertIdentifier(input.attemptId, "attempt_id");
  if (input.preparedManifestKey) {
    assertSha256(input.preparedManifestKey, "prepared_manifest_key");
  }
  if (
    input.preparedManifestCanonicalJson !== null &&
    (input.preparedManifestCanonicalJson.length === 0 ||
      new TextEncoder().encode(input.preparedManifestCanonicalJson).byteLength >
        262_144)
  ) {
    throw new Error("review_execution_prepared_manifest_invalid");
  }
  if (input.sourceObservationId)
    assertIdentifier(input.sourceObservationId, "source_observation_id");
  assertReviewExecutionLimits(input.limits);
  if (!validLeaseDeadlines(input, input.limits)) {
    throw new Error("review_execution_invalid_lease_deadlines");
  }
  if (
    input.retainUntil <= input.resultReportUntil ||
    input.fencingToken <= 0n
  ) {
    throw new Error("review_execution_invalid_lease_retention");
  }
}

function validLeaseDeadlines(
  input: {
    readonly now: Date;
    readonly expiresAt: Date;
    readonly resultReportUntil: Date;
  },
  limits: Pick<
    ReviewExecutionLimits,
    "maxLeaseDurationMs" | "maxResultReportDurationMs"
  >,
): boolean {
  return (
    input.expiresAt > input.now &&
    input.resultReportUntil >= input.expiresAt &&
    input.expiresAt.getTime() - input.now.getTime() <=
      limits.maxLeaseDurationMs &&
    input.resultReportUntil.getTime() - input.now.getTime() <=
      limits.maxResultReportDurationMs
  );
}
