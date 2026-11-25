import {
  ReviewExecutionState,
  ReviewWorkSlotState,
  ReviewWorkSlotTerminalReason,
  assertDate,
  assertReviewRevision,
  reviewExecutionIsTerminal,
  reviewRevisionsEqual,
  type ReviewExecution,
  type ReviewExecutionStream,
  type ReviewInvocationLease,
  type ReviewRevision,
} from "./review-execution";
import {
  cancelNonTerminalWorkSlots,
  replaceExecutionSlot,
  revokeActiveLeases,
  assertSameScope,
} from "./review-execution-transition-invariants";

export enum ExecutionLifecycleDecisionStatus {
  Applied = "applied",
  Restored = "restored",
  NotEligible = "not_eligible",
}

export type ExecutionLifecycleDecision = {
  readonly status: ExecutionLifecycleDecisionStatus;
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly revokedLeases: readonly ReviewInvocationLease[];
};

export function decideExecutionSupersession(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly activeLeases: readonly ReviewInvocationLease[];
  readonly observedCurrentRevision: ReviewRevision;
  readonly now: Date;
}): ExecutionLifecycleDecision {
  assertReviewRevision(input.observedCurrentRevision);
  assertDate(input.now, "superseded_at");
  assertSameScope(input.stream, input.execution, "supersession_execution");
  if (input.execution.state === ReviewExecutionState.Superseded) {
    return unchangedLifecycle(ExecutionLifecycleDecisionStatus.Restored, input);
  }
  if (reviewExecutionIsTerminal(input.execution.state)) {
    return unchangedLifecycle(
      ExecutionLifecycleDecisionStatus.NotEligible,
      input,
    );
  }
  const ownsActive =
    input.stream.activeExecutionId === input.execution.executionId;
  const ownsPrepared =
    input.stream.preparedExecutionId === input.execution.executionId;
  if (!ownsActive && !ownsPrepared) {
    return unchangedLifecycle(
      ExecutionLifecycleDecisionStatus.NotEligible,
      input,
    );
  }
  return {
    status: ExecutionLifecycleDecisionStatus.Applied,
    execution: transitionExecutionToSuperseded(
      input.execution,
      null,
      input.now,
    ),
    stream: {
      ...input.stream,
      version: input.stream.version + 1n,
      activeExecutionId: ownsActive ? null : input.stream.activeExecutionId,
      preparedExecutionId: ownsPrepared
        ? null
        : input.stream.preparedExecutionId,
      currentRevision: { ...input.observedCurrentRevision },
      updatedAt: new Date(input.now),
    },
    revokedLeases: revokeActiveLeases(
      input.activeLeases,
      input.execution.executionId,
    ),
  };
}

export function decideAbandonedPreparationFailure(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly now: Date;
}): ExecutionLifecycleDecision {
  assertDate(input.now, "abandoned_at");
  assertSameScope(input.stream, input.execution, "abandoned_execution");
  if (input.execution.state === ReviewExecutionState.Failed) {
    return unchangedLifecycle(ExecutionLifecycleDecisionStatus.Restored, {
      ...input,
      activeLeases: [],
    });
  }
  if (
    input.execution.state !== ReviewExecutionState.Planned ||
    input.stream.preparedExecutionId !== input.execution.executionId ||
    input.execution.admissionDeadlineAt > input.now
  ) {
    return unchangedLifecycle(ExecutionLifecycleDecisionStatus.NotEligible, {
      ...input,
      activeLeases: [],
    });
  }
  return {
    status: ExecutionLifecycleDecisionStatus.Applied,
    execution: {
      ...input.execution,
      version: input.execution.version + 1n,
      state: ReviewExecutionState.Failed,
      workSlots: cancelNonTerminalWorkSlots(input.execution.workSlots),
      updatedAt: new Date(input.now),
    },
    stream: {
      ...input.stream,
      version: input.stream.version + 1n,
      preparedExecutionId: null,
      updatedAt: new Date(input.now),
    },
    revokedLeases: [],
  };
}

export enum WorkSlotTerminalizationDecisionStatus {
  Applied = "applied",
  Restored = "restored",
  NotEligible = "not_eligible",
  Conflict = "conflict",
}

export function decideWorkSlotTerminalization(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly workSlotId: string;
  readonly terminalState:
    | ReviewWorkSlotState.Exhausted
    | ReviewWorkSlotState.Cancelled;
  readonly reasonCode: ReviewWorkSlotTerminalReason;
  readonly generation: bigint;
  readonly reviewRevisionHash: string;
  readonly now: Date;
}) {
  assertDate(input.now, "work_slot_terminalized_at");
  const slot = input.execution.workSlots.find(
    (candidate) => candidate.workSlotId === input.workSlotId,
  );
  if (slot === undefined) {
    return {
      status: WorkSlotTerminalizationDecisionStatus.NotEligible,
    } as const;
  }
  const validPair =
    (input.terminalState === ReviewWorkSlotState.Exhausted &&
      input.reasonCode ===
        ReviewWorkSlotTerminalReason.AttemptBudgetExhausted) ||
    (input.terminalState === ReviewWorkSlotState.Cancelled &&
      input.reasonCode === ReviewWorkSlotTerminalReason.DeadlineReached);
  if (!validPair) {
    return { status: WorkSlotTerminalizationDecisionStatus.Conflict } as const;
  }
  if (
    input.execution.generation !== input.generation ||
    input.execution.revision.reviewRevisionHash !== input.reviewRevisionHash
  ) {
    return {
      status: WorkSlotTerminalizationDecisionStatus.NotEligible,
    } as const;
  }
  if (slot.state === input.terminalState) {
    return {
      status: WorkSlotTerminalizationDecisionStatus.Restored,
      execution: input.execution,
    } as const;
  }
  if (
    input.stream.activeExecutionId !== input.execution.executionId ||
    input.execution.state !== ReviewExecutionState.Running ||
    input.stream.currentRevision === null ||
    !reviewRevisionsEqual(
      input.stream.currentRevision,
      input.execution.revision,
    )
  ) {
    return {
      status: WorkSlotTerminalizationDecisionStatus.NotEligible,
    } as const;
  }
  if (
    slot.state === ReviewWorkSlotState.Satisfied ||
    slot.state === ReviewWorkSlotState.Exhausted ||
    slot.state === ReviewWorkSlotState.Cancelled ||
    slot.activeLeaseId !== null
  ) {
    return { status: WorkSlotTerminalizationDecisionStatus.Conflict } as const;
  }
  return {
    status: WorkSlotTerminalizationDecisionStatus.Applied,
    execution: replaceExecutionSlot(
      input.execution,
      { ...slot, state: input.terminalState, activeLeaseId: null },
      input.now,
    ),
  } as const;
}

export function decideExpiredRunningExecutionFailure(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly activeLeases: readonly ReviewInvocationLease[];
  readonly now: Date;
  /** The worker proved this exact source attempt failed and its authority is terminal. */
  readonly sourceTerminal?: boolean;
}): ExecutionLifecycleDecision {
  assertDate(input.now, "execution_expiry_now");
  if (input.execution.state === ReviewExecutionState.Failed) {
    return {
      status: ExecutionLifecycleDecisionStatus.Restored,
      stream: input.stream,
      execution: input.execution,
      revokedLeases: revokeActiveLeases(
        input.activeLeases,
        input.execution.executionId,
      ),
    };
  }
  if (
    input.execution.state !== ReviewExecutionState.Running ||
    input.stream.activeExecutionId !== input.execution.executionId ||
    (!input.sourceTerminal && input.execution.executionDeadlineAt > input.now)
  ) {
    return unchangedLifecycle(
      ExecutionLifecycleDecisionStatus.NotEligible,
      input,
    );
  }
  return {
    status: ExecutionLifecycleDecisionStatus.Applied,
    execution: {
      ...input.execution,
      version: input.execution.version + 1n,
      state: ReviewExecutionState.Failed,
      workSlots: cancelNonTerminalWorkSlots(input.execution.workSlots),
      updatedAt: new Date(input.now),
    },
    stream: {
      ...input.stream,
      version: input.stream.version + 1n,
      activeExecutionId: null,
      updatedAt: new Date(input.now),
    },
    revokedLeases: revokeActiveLeases(
      input.activeLeases,
      input.execution.executionId,
    ),
  };
}

export function transitionExecutionToSuperseded(
  execution: ReviewExecution,
  supersededByExecutionId: string | null,
  now: Date,
): ReviewExecution {
  return {
    ...execution,
    version: execution.version + 1n,
    state: ReviewExecutionState.Superseded,
    supersededByExecutionId,
    workSlots: cancelNonTerminalWorkSlots(execution.workSlots),
    updatedAt: new Date(now),
  };
}

function unchangedLifecycle(
  status: ExecutionLifecycleDecisionStatus,
  input: {
    readonly stream: ReviewExecutionStream;
    readonly execution: ReviewExecution;
    readonly activeLeases: readonly ReviewInvocationLease[];
  },
): ExecutionLifecycleDecision {
  return {
    status,
    stream: input.stream,
    execution: input.execution,
    revokedLeases: [],
  };
}
