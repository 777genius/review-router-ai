import {
  ReviewCoverageState,
  ReviewExecutionState,
  assertDate,
  assertFinalizationEnvelope,
  assertIdentifier,
  assertReviewExecutionLimits,
  assertReviewExecutionScope,
  assertSha256,
  deriveCoverageState,
  reviewRevisionsEqual,
  type FinalizedReviewProjectionArtifact,
  type PublicationPermit,
  type ReviewExecution,
  type ReviewExecutionLimits,
  type ReviewExecutionScope,
  type ReviewExecutionStream,
  type ReviewCoverageExceptions,
  type ReviewInvocationLease,
} from "./review-execution";
import {
  cancelNonTerminalWorkSlots,
  revokeActiveLeases,
  isCurrentRunning,
  assertSameScope,
} from "./review-execution-transition-invariants";

export enum ExecutionFinalizationDecisionStatus {
  Finalized = "finalized",
  NotRunnable = "not_runnable",
  RequiredCoverageIncomplete = "required_coverage_incomplete",
}

export enum ExecutionFinalizationReplayDecisionStatus {
  Proceed = "proceed",
  Restored = "restored",
  Conflict = "conflict",
}

export type ExecutionFinalizationReplayDecision =
  | {
      readonly status: ExecutionFinalizationReplayDecisionStatus.Proceed;
    }
  | {
      readonly status: ExecutionFinalizationReplayDecisionStatus.Restored;
      readonly artifact: FinalizedReviewProjectionArtifact;
    }
  | {
      readonly status: ExecutionFinalizationReplayDecisionStatus.Conflict;
    };

export function decideExecutionFinalizationReplay(input: {
  readonly executionId: string;
  readonly existingArtifact: FinalizedReviewProjectionArtifact | null;
  readonly existingArtifactHash: string | null;
  readonly artifactHash: string;
}): ExecutionFinalizationReplayDecision {
  assertIdentifier(input.executionId, "execution_id");
  assertSha256(input.artifactHash, "artifact_hash");
  if (input.existingArtifact === null) {
    if (input.existingArtifactHash !== null) {
      throw new Error("review_execution_artifact_index_corrupted");
    }
    return { status: ExecutionFinalizationReplayDecisionStatus.Proceed };
  }
  if (input.existingArtifactHash === null) {
    throw new Error("review_execution_artifact_index_corrupted");
  }
  if (input.existingArtifact.executionId !== input.executionId) {
    throw new Error("review_execution_artifact_index_corrupted");
  }
  return input.existingArtifactHash === input.artifactHash
    ? {
        status: ExecutionFinalizationReplayDecisionStatus.Restored,
        artifact: input.existingArtifact,
      }
    : { status: ExecutionFinalizationReplayDecisionStatus.Conflict };
}

export type ExecutionFinalizationDecision =
  | {
      readonly status: ExecutionFinalizationDecisionStatus.Finalized;
      readonly stream: ReviewExecutionStream;
      readonly execution: ReviewExecution;
      readonly artifact: FinalizedReviewProjectionArtifact;
      readonly revokedLeases: readonly ReviewInvocationLease[];
    }
  | {
      readonly status: ExecutionFinalizationDecisionStatus.NotRunnable;
    }
  | {
      readonly status: ExecutionFinalizationDecisionStatus.RequiredCoverageIncomplete;
    };

export type FinalizeExecutionTransitionInput = {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly activeLeases: readonly ReviewInvocationLease[];
  readonly scope: ReviewExecutionScope;
  readonly artifactId: string;
  readonly projectionEnvelopeVersion: number;
  readonly projectionEnvelopeJson: string;
  readonly projectionHash: string;
  readonly byteCount: number;
  readonly findingCount: number;
  readonly lifecycleStateHash: string;
  readonly commandLedgerWatermark: bigint;
  readonly projectionPolicyVersion: string;
  readonly publicationSafetyDecisionHash: string;
  readonly publicationNotAfter: Date;
  readonly permitEpoch: bigint;
  readonly allowPartial: boolean;
  readonly coverageExceptions?: ReviewCoverageExceptions;
  readonly limits: ReviewExecutionLimits;
  readonly now: Date;
  readonly retainUntil: Date;
};

export function decideExecutionFinalization(
  input: FinalizeExecutionTransitionInput,
): ExecutionFinalizationDecision {
  assertFinalizeInput(input);
  assertSameScope(input.stream, input.execution, "finalization_execution");
  assertSameScope(input.execution, input.scope, "finalization_command");
  if (
    !isCurrentRunning(input.stream, input.execution) ||
    input.stream.currentRevision === null ||
    !reviewRevisionsEqual(
      input.stream.currentRevision,
      input.execution.revision,
    )
  ) {
    return { status: ExecutionFinalizationDecisionStatus.NotRunnable };
  }
  const coverageState = deriveCoverageState(
    input.execution.workSlots,
    input.coverageExceptions,
  );
  if (coverageState === ReviewCoverageState.Partial && !input.allowPartial) {
    return {
      status: ExecutionFinalizationDecisionStatus.RequiredCoverageIncomplete,
    };
  }
  const permit: PublicationPermit = {
    ...input.scope,
    executionId: input.execution.executionId,
    generation: input.execution.generation,
    authorizationId: input.execution.authorizationId,
    producerReleaseId: input.execution.producerReleaseId,
    reviewedHeadSha: input.execution.revision.headSha,
    reviewRevisionHash: input.execution.revision.reviewRevisionHash,
    projectionHash: input.projectionHash,
    lifecycleStateHash: input.lifecycleStateHash,
    commandLedgerWatermark: input.commandLedgerWatermark,
    permitEpoch: input.permitEpoch,
    publicationSafetyDecisionHash: input.publicationSafetyDecisionHash,
    publicationNotAfter: new Date(input.publicationNotAfter),
  };
  const artifact: FinalizedReviewProjectionArtifact = {
    artifactId: input.artifactId,
    executionId: input.execution.executionId,
    generation: input.execution.generation,
    reviewedHeadSha: input.execution.revision.headSha,
    reviewRevisionHash: input.execution.revision.reviewRevisionHash,
    coverageState,
    projectionEnvelopeVersion: input.projectionEnvelopeVersion,
    projectionEnvelopeJson: input.projectionEnvelopeJson,
    projectionHash: input.projectionHash,
    byteCount: input.byteCount,
    findingCount: input.findingCount,
    lifecycleStateHash: input.lifecycleStateHash,
    commandLedgerWatermark: input.commandLedgerWatermark,
    projectionPolicyVersion: input.projectionPolicyVersion,
    publicationPermit: permit,
    createdAt: new Date(input.now),
    retainUntil: new Date(input.retainUntil),
  };
  const terminalSlots = cancelNonTerminalWorkSlots(input.execution.workSlots);
  return {
    status: ExecutionFinalizationDecisionStatus.Finalized,
    artifact,
    revokedLeases: revokeActiveLeases(
      input.activeLeases,
      input.execution.executionId,
    ),
    execution: {
      ...input.execution,
      version: input.execution.version + 1n,
      state:
        coverageState === ReviewCoverageState.Completed
          ? ReviewExecutionState.Completed
          : ReviewExecutionState.Partial,
      workSlots: terminalSlots,
      finalizedArtifactId: artifact.artifactId,
      updatedAt: new Date(input.now),
    },
    stream: {
      ...input.stream,
      version: input.stream.version + 1n,
      updatedAt: new Date(input.now),
    },
  };
}

function assertFinalizeInput(input: FinalizeExecutionTransitionInput): void {
  assertReviewExecutionScope(input.scope);
  assertIdentifier(input.artifactId, "artifact_id");
  assertSha256(input.lifecycleStateHash, "lifecycle_state_hash");
  assertSha256(
    input.publicationSafetyDecisionHash,
    "publication_safety_decision_hash",
  );
  assertIdentifier(input.projectionPolicyVersion, "projection_policy_version");
  assertDate(input.now, "finalized_at");
  assertDate(input.publicationNotAfter, "publication_not_after");
  assertDate(input.retainUntil, "artifact_retain_until");
  if (
    input.publicationNotAfter <= input.now ||
    input.retainUntil <= input.publicationNotAfter ||
    input.commandLedgerWatermark < 0n ||
    input.permitEpoch <= 0n
  ) {
    throw new Error("review_execution_invalid_finalization_window");
  }
  assertReviewExecutionLimits(input.limits);
  assertFinalizationEnvelope(input);
}
