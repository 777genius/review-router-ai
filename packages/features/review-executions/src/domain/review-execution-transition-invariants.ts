import {
  ReviewExecutionState,
  ReviewInvocationLeaseState,
  ReviewWorkSlotState,
  scopeKey,
  type ReviewExecution,
  type ReviewExecutionScope,
  type ReviewExecutionStream,
  type ReviewInvocationLease,
  type ReviewWorkSlot,
} from "./review-execution";

export function cancelNonTerminalWorkSlots(
  workSlots: readonly ReviewWorkSlot[],
): readonly ReviewWorkSlot[] {
  return workSlots.map((slot) =>
    slot.state === ReviewWorkSlotState.Satisfied ||
    slot.state === ReviewWorkSlotState.Exhausted ||
    slot.state === ReviewWorkSlotState.Cancelled
      ? slot
      : { ...slot, state: ReviewWorkSlotState.Cancelled, activeLeaseId: null },
  );
}

export function replaceExecutionSlot(
  execution: ReviewExecution,
  slot: ReviewWorkSlot,
  now: Date,
): ReviewExecution {
  return {
    ...execution,
    version: execution.version + 1n,
    workSlots: execution.workSlots.map((candidate) =>
      candidate.workSlotId === slot.workSlotId ? slot : candidate,
    ),
    updatedAt: new Date(now),
  };
}

export function revokeActiveLeases(
  leases: readonly ReviewInvocationLease[],
  executionId: string,
): readonly ReviewInvocationLease[] {
  for (const lease of leases) {
    if (
      lease.executionId !== executionId ||
      lease.state !== ReviewInvocationLeaseState.Active
    ) {
      throw new Error("review_execution_invalid_active_lease_set");
    }
  }
  return leases.map((lease) => ({
    ...lease,
    state: ReviewInvocationLeaseState.Revoked,
  }));
}

export function isCurrentRunning(
  stream: ReviewExecutionStream,
  execution: ReviewExecution,
): boolean {
  return (
    stream.activeExecutionId === execution.executionId &&
    execution.state === ReviewExecutionState.Running
  );
}

export function assertSameScope(
  left: ReviewExecutionScope,
  right: ReviewExecutionScope,
  relation: string,
): void {
  if (scopeKey(left) !== scopeKey(right)) {
    throw new Error(`review_execution_scope_mismatch_${relation}`);
  }
}

export function leaseTermMatches(
  lease: ReviewInvocationLease,
  term: {
    readonly ownerIdHash: string;
    readonly leaseCapabilityId: string;
    readonly fencingToken: bigint;
  },
): boolean {
  return (
    lease.ownerIdHash === term.ownerIdHash &&
    lease.leaseCapabilityId === term.leaseCapabilityId &&
    lease.fencingToken === term.fencingToken
  );
}
