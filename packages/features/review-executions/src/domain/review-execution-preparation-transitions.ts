import {
  ReviewExecutionState,
  assertDate,
  assertIdentifier,
  assertReviewExecutionLimits,
  assertReviewExecutionScope,
  assertReviewRevision,
  assertSha256,
  prepareWorkSlots,
  reviewExecutionIsTerminal,
  reviewRevisionsEqual,
  type ReviewExecution,
  type ReviewExecutionLimits,
  type ReviewExecutionScope,
  type ReviewExecutionStream,
  type ReviewInvocationLease,
  type ReviewRevision,
  type ReviewWorkSlotPlan,
} from "./review-execution";
import { transitionExecutionToSuperseded } from "./review-execution-lifecycle-transitions";
import {
  revokeActiveLeases,
  assertSameScope,
} from "./review-execution-transition-invariants";

export enum ExecutionPreparationReplayDecisionStatus {
  Proceed = "proceed",
  Restored = "restored",
  IdempotencyConflict = "idempotency_conflict",
}

export type ExecutionPreparationReplayDecision =
  | {
      readonly status: ExecutionPreparationReplayDecisionStatus.Proceed;
    }
  | {
      readonly status: ExecutionPreparationReplayDecisionStatus.Restored;
      readonly execution: ReviewExecution;
    }
  | {
      readonly status: ExecutionPreparationReplayDecisionStatus.IdempotencyConflict;
    };

export function decideExecutionPreparationReplay(input: {
  readonly existingByStartIdentity: ReviewExecution | null;
  readonly canonicalStartHash: string;
}): ExecutionPreparationReplayDecision {
  assertSha256(input.canonicalStartHash, "canonical_start_hash");
  if (input.existingByStartIdentity === null) {
    return { status: ExecutionPreparationReplayDecisionStatus.Proceed };
  }
  return input.existingByStartIdentity.canonicalStartHash ===
    input.canonicalStartHash
    ? {
        status: ExecutionPreparationReplayDecisionStatus.Restored,
        execution: input.existingByStartIdentity,
      }
    : {
        status: ExecutionPreparationReplayDecisionStatus.IdempotencyConflict,
      };
}

export enum ExecutionPrepareDecisionStatus {
  Prepared = "prepared",
}

export type ExecutionPrepareDecision = {
  readonly status: ExecutionPrepareDecisionStatus.Prepared;
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly supersededPrepared: ReviewExecution | null;
};

export type PrepareExecutionTransitionInput = {
  readonly historyRootRequestId?: string | null;
  readonly historyDispatchAttempt?: number | null;
  readonly stream: ReviewExecutionStream;
  readonly priorPrepared: ReviewExecution | null;
  readonly scope: ReviewExecutionScope;
  readonly executionId: string;
  readonly authorizationId: string;
  readonly producerReleaseId: string;
  readonly mutationEpoch: bigint;
  readonly revision: ReviewRevision;
  readonly startIdentityHash: string;
  readonly canonicalStartHash: string;
  readonly admissionSafetyDecisionHash: string;
  readonly compatibilityKey: string;
  readonly planHash: string;
  readonly assignmentManifestVersion?: 1 | 2 | null;
  readonly assignmentManifestHash?: string | null;
  readonly assignmentManifestCanonicalJson?: string | null;
  readonly workSlots: readonly ReviewWorkSlotPlan[];
  readonly limits: ReviewExecutionLimits;
  readonly sourceRunId: string;
  readonly sourceRunAttempt: string;
  readonly now: Date;
  readonly admissionDeadlineAt: Date;
  readonly executionDeadlineAt: Date;
  readonly retainUntil: Date;
};

export function decideExecutionPreparation(
  input: PrepareExecutionTransitionInput,
): ExecutionPrepareDecision {
  assertPrepareInput(input);
  const generation = input.stream.lastAllocatedGeneration + 1n;
  const execution: ReviewExecution = {
    ...input.scope,
    executionId: input.executionId,
    historyRootRequestId: input.historyRootRequestId ?? null,
    historyDispatchAttempt: input.historyDispatchAttempt ?? null,
    version: 1n,
    generation,
    revision: { ...input.revision },
    authorizationId: input.authorizationId,
    producerReleaseId: input.producerReleaseId,
    mutationEpoch: input.mutationEpoch,
    startIdentityHash: input.startIdentityHash,
    canonicalStartHash: input.canonicalStartHash,
    admissionSafetyDecisionHash: input.admissionSafetyDecisionHash,
    state: ReviewExecutionState.Planned,
    compatibilityKey: input.compatibilityKey,
    planHash: input.planHash,
    assignmentManifestVersion: input.assignmentManifestVersion ?? null,
    assignmentManifestHash: input.assignmentManifestHash ?? null,
    assignmentManifestCanonicalJson:
      input.assignmentManifestCanonicalJson ?? null,
    protocolLimitsProfileId: input.limits.profileId,
    sourceRunId: input.sourceRunId,
    sourceRunAttempt: input.sourceRunAttempt,
    workSlots: prepareWorkSlots(input.workSlots, input.limits),
    finalizedArtifactId: null,
    supersededByExecutionId: null,
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now),
    admissionDeadlineAt: new Date(input.admissionDeadlineAt),
    admissionCheckedAt: null,
    executionDeadlineAt: new Date(input.executionDeadlineAt),
    retainUntil: new Date(input.retainUntil),
  };
  return {
    status: ExecutionPrepareDecisionStatus.Prepared,
    execution,
    supersededPrepared:
      input.priorPrepared?.state === ReviewExecutionState.Planned
        ? transitionExecutionToSuperseded(
            input.priorPrepared,
            execution.executionId,
            input.now,
          )
        : null,
    stream: {
      ...input.stream,
      version: input.stream.version + 1n,
      preparedExecutionId: execution.executionId,
      lastAllocatedGeneration: generation,
      updatedAt: new Date(input.now),
    },
  };
}

export enum ExecutionAdmissionDecisionStatus {
  Admitted = "admitted",
  Restored = "restored",
  Superseded = "superseded",
  Deferred = "deferred",
  NotPrepared = "not_prepared",
}

export enum ExecutionAdmissionVerdict {
  Current = "current",
  Stale = "stale",
  Unavailable = "unavailable",
}

export type ExecutionAdmissionDecision = {
  readonly status: ExecutionAdmissionDecisionStatus;
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly supersededPriorActive: ReviewExecution | null;
  readonly revokedPriorLeases: readonly ReviewInvocationLease[];
};

export function decideExecutionAdmission(input: {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly priorActive: ReviewExecution | null;
  readonly priorActiveLeases: readonly ReviewInvocationLease[];
  readonly authorizationId: string;
  readonly mutationEpoch: bigint;
  readonly requestedRevision: ReviewRevision;
  readonly observedRevision: ReviewRevision | null;
  readonly verdict: ExecutionAdmissionVerdict;
  readonly checkedAt: Date;
}): ExecutionAdmissionDecision {
  assertSameScope(input.stream, input.execution, "admission_execution");
  if (input.priorActive !== null) {
    assertSameScope(input.execution, input.priorActive, "admission_prior");
  }
  assertDate(input.checkedAt, "admission_checked_at");
  assertIdentifier(input.authorizationId, "authorization_id");
  if (input.mutationEpoch <= 0n) {
    throw new Error("review_execution_invalid_mutation_epoch");
  }
  assertReviewRevision(input.requestedRevision);
  if (input.observedRevision !== null) {
    assertReviewRevision(input.observedRevision);
  }
  const identityMatches =
    input.execution.authorizationId === input.authorizationId &&
    input.execution.mutationEpoch === input.mutationEpoch &&
    reviewRevisionsEqual(input.execution.revision, input.requestedRevision);
  if (
    input.execution.state === ReviewExecutionState.Running &&
    input.stream.activeExecutionId === input.execution.executionId
  ) {
    return unchangedAdmission(
      identityMatches
        ? ExecutionAdmissionDecisionStatus.Restored
        : ExecutionAdmissionDecisionStatus.NotPrepared,
      input,
    );
  }
  if (
    input.execution.state === ReviewExecutionState.Superseded &&
    input.verdict === ExecutionAdmissionVerdict.Stale &&
    identityMatches
  ) {
    return unchangedAdmission(
      ExecutionAdmissionDecisionStatus.Superseded,
      input,
    );
  }
  if (
    input.execution.state !== ReviewExecutionState.Planned ||
    input.stream.preparedExecutionId !== input.execution.executionId ||
    !identityMatches
  ) {
    return unchangedAdmission(
      ExecutionAdmissionDecisionStatus.NotPrepared,
      input,
    );
  }
  if (input.verdict === ExecutionAdmissionVerdict.Unavailable) {
    return unchangedAdmission(ExecutionAdmissionDecisionStatus.Deferred, input);
  }
  if (
    input.verdict === ExecutionAdmissionVerdict.Stale ||
    input.observedRevision === null ||
    !reviewRevisionsEqual(input.observedRevision, input.execution.revision)
  ) {
    return {
      status: ExecutionAdmissionDecisionStatus.Superseded,
      execution: transitionExecutionToSuperseded(
        input.execution,
        null,
        input.checkedAt,
      ),
      stream: {
        ...input.stream,
        version: input.stream.version + 1n,
        preparedExecutionId: null,
        updatedAt: new Date(input.checkedAt),
      },
      supersededPriorActive: null,
      revokedPriorLeases: [],
    };
  }
  const prior = input.priorActive;
  const supersededPriorActive =
    prior !== null &&
    prior.executionId !== input.execution.executionId &&
    !reviewExecutionIsTerminal(prior.state)
      ? transitionExecutionToSuperseded(
          prior,
          input.execution.executionId,
          input.checkedAt,
        )
      : null;
  const revokedPriorLeases =
    supersededPriorActive === null
      ? []
      : revokeActiveLeases(
          input.priorActiveLeases,
          supersededPriorActive.executionId,
        );
  return {
    status: ExecutionAdmissionDecisionStatus.Admitted,
    execution: {
      ...input.execution,
      version: input.execution.version + 1n,
      state: ReviewExecutionState.Running,
      admissionCheckedAt: new Date(input.checkedAt),
      updatedAt: new Date(input.checkedAt),
    },
    stream: {
      ...input.stream,
      version: input.stream.version + 1n,
      activeExecutionId: input.execution.executionId,
      preparedExecutionId: null,
      currentRevision: { ...input.execution.revision },
      updatedAt: new Date(input.checkedAt),
    },
    supersededPriorActive,
    revokedPriorLeases,
  };
}

function unchangedAdmission(
  status: ExecutionAdmissionDecisionStatus,
  input: {
    readonly stream: ReviewExecutionStream;
    readonly execution: ReviewExecution;
  },
): ExecutionAdmissionDecision {
  return {
    status,
    stream: input.stream,
    execution: input.execution,
    supersededPriorActive: null,
    revokedPriorLeases: [],
  };
}

function assertPrepareInput(input: PrepareExecutionTransitionInput): void {
  assertReviewExecutionScope(input.scope);
  assertSameScope(input.scope, input.stream, "preparation_stream");
  if (input.priorPrepared !== null) {
    assertSameScope(input.scope, input.priorPrepared, "preparation_prior");
  }
  if (
    (input.stream.preparedExecutionId === null) !==
      (input.priorPrepared === null) ||
    (input.priorPrepared !== null &&
      input.stream.preparedExecutionId !== input.priorPrepared.executionId)
  ) {
    throw new Error("review_execution_prepared_reference_corrupted");
  }
  assertIdentifier(input.executionId, "execution_id");
  assertIdentifier(input.authorizationId, "authorization_id");
  assertIdentifier(input.producerReleaseId, "producer_release_id");
  if (input.mutationEpoch <= 0n) {
    throw new Error("review_execution_invalid_mutation_epoch");
  }
  assertReviewRevision(input.revision);
  assertSha256(input.startIdentityHash, "start_identity_hash");
  assertSha256(input.canonicalStartHash, "canonical_start_hash");
  assertSha256(
    input.admissionSafetyDecisionHash,
    "admission_safety_decision_hash",
  );
  assertSha256(input.planHash, "plan_hash");
  assertIdentifier(input.compatibilityKey, "compatibility_key");
  assertIdentifier(input.sourceRunId, "source_run_id");
  assertIdentifier(input.sourceRunAttempt, "source_run_attempt");
  assertReviewExecutionLimits(input.limits);
  for (const date of [
    input.now,
    input.admissionDeadlineAt,
    input.executionDeadlineAt,
    input.retainUntil,
  ]) {
    assertDate(date, "execution_deadline");
  }
  if (
    input.admissionDeadlineAt <= input.now ||
    input.executionDeadlineAt <= input.admissionDeadlineAt ||
    input.retainUntil <= input.executionDeadlineAt
  ) {
    throw new Error("review_execution_invalid_deadline_order");
  }
}
