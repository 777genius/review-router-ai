import {
  AcceptReviewObservationStatus,
  LookupReviewEvidenceStatus,
  prepareReviewObservationPayload,
  type ReviewObservation,
} from "@reviewrouter/features-review-evidence";
import {
  AcquireOrJoinInvocationFlightStatus,
  ReviewExecutionFinalizeStatus,
  ReviewExecutionLifecycleTransitionStatus,
  ReviewInvocationLeaseTransitionStatus,
  ReviewObservationAttachmentStatus,
  StartReviewExecutionStatus,
  type ReviewExecutionSnapshot,
  type ReviewInvocationLease,
} from "@reviewrouter/features-review-executions";
import { canonicalJson } from "@reviewrouter/features-review-run-control";
import {
  ReviewEvidenceCommitResultStatus,
  ReviewEvidenceLookupResultStatus,
  ReviewExecutionMutationResultStatus,
  ReviewExecutionStartResultStatus,
  ReviewInvocationLeaseResultStatus,
  type ReviewExecutionObservationAdoptRequest,
  type ReviewExecutionObservationAttachRequest,
} from "@reviewrouter/protocol-review-action-v2";

// Internal response owner: pure domain-to-protocol projection.
// No database, transport or authorization side effects belong here.
export function canonicalPayload(observation: ReviewObservation): string {
  return new TextDecoder().decode(
    prepareReviewObservationPayload(observation.payload).canonicalBytes,
  );
}
export function mutationResult(
  status: ReviewExecutionLifecycleTransitionStatus,
  executionId: string,
  snapshot: ReviewExecutionSnapshot,
) {
  return {
    status:
      status === ReviewExecutionLifecycleTransitionStatus.Applied
        ? ReviewExecutionMutationResultStatus.Applied
        : status === ReviewExecutionLifecycleTransitionStatus.Restored
          ? ReviewExecutionMutationResultStatus.Restored
          : status === ReviewExecutionLifecycleTransitionStatus.Missing
            ? ReviewExecutionMutationResultStatus.Missing
            : ReviewExecutionMutationResultStatus.Conflict,
    executionId,
    streamVersion: snapshot.stream.version.toString(10),
  };
}
export function attachmentResult(
  status: ReviewObservationAttachmentStatus,
  request: Pick<
    ReviewExecutionObservationAttachRequest,
    "executionId" | "workSlotId"
  >,
  snapshot: ReviewExecutionSnapshot,
) {
  return {
    status: mapAttachmentStatus(status),
    executionId: request.executionId,
    workSlotId: request.workSlotId,
    streamVersion: snapshot.stream.version.toString(10),
  };
}
export function mapAttachmentStatus(status: ReviewObservationAttachmentStatus) {
  return status === ReviewObservationAttachmentStatus.Attached
    ? ReviewExecutionMutationResultStatus.Applied
    : status === ReviewObservationAttachmentStatus.Restored
      ? ReviewExecutionMutationResultStatus.Restored
      : status === ReviewObservationAttachmentStatus.Missing
        ? ReviewExecutionMutationResultStatus.Missing
        : status === ReviewObservationAttachmentStatus.Conflict
          ? ReviewExecutionMutationResultStatus.Conflict
          : ReviewExecutionMutationResultStatus.Rejected;
}
export function adoptionResult(
  status: ReviewExecutionMutationResultStatus,
  request: ReviewExecutionObservationAdoptRequest,
  snapshot: ReviewExecutionSnapshot,
  observation: ReviewObservation | null,
) {
  return {
    status,
    executionId: request.executionId,
    workSlotId: request.workSlotId,
    streamVersion: snapshot.stream.version.toString(10),
    observationPayloadCanonicalJson:
      observation === null ? null : canonicalPayload(observation),
    observationFactsCanonicalJson:
      observation === null
        ? null
        : canonicalJson({
            observationId: observation.observationId,
            sourceExecutionId: observation.sourceExecutionId,
            sourceLeaseId: observation.sourceLeaseId,
            sourceFencingToken: observation.sourceFencingToken,
            providerInvocationKey: observation.providerInvocationKey,
            providerVoteIdentityHash: observation.providerVoteIdentityHash,
            manifestKey: observation.manifestKey,
            payloadHash: observation.payloadHash,
            byteCount: observation.byteCount,
            findingCount: observation.findingCount,
            actualModel: observation.actualModel,
            qualityFlags: observation.qualityFlags,
            transportAttemptCount: observation.transportAttemptCount,
            eligibilityPolicyVersion: request.eligibilityPolicyVersion,
            planHash: request.planHash,
            reviewRevisionHash: request.reviewRevisionHash,
          }),
  };
}
export function mapFinalize(status: ReviewExecutionFinalizeStatus) {
  return status === ReviewExecutionFinalizeStatus.Finalized
    ? ReviewExecutionMutationResultStatus.Applied
    : status === ReviewExecutionFinalizeStatus.Restored
      ? ReviewExecutionMutationResultStatus.Restored
      : status === ReviewExecutionFinalizeStatus.Missing
        ? ReviewExecutionMutationResultStatus.Missing
        : status === ReviewExecutionFinalizeStatus.Conflict
          ? ReviewExecutionMutationResultStatus.Conflict
          : ReviewExecutionMutationResultStatus.Rejected;
}
export function mapStart(
  status: StartReviewExecutionStatus,
): ReviewExecutionStartResultStatus {
  switch (status) {
    case StartReviewExecutionStatus.Admitted:
      return ReviewExecutionStartResultStatus.Admitted;
    case StartReviewExecutionStatus.Restored:
      return ReviewExecutionStartResultStatus.Restored;
    case StartReviewExecutionStatus.AdmissionDeferred:
      return ReviewExecutionStartResultStatus.AdmissionDeferred;
    case StartReviewExecutionStatus.StaleRevision:
      return ReviewExecutionStartResultStatus.StaleRevision;
    case StartReviewExecutionStatus.AuthorizationRejected:
    case StartReviewExecutionStatus.RequestIntentMissing:
      return ReviewExecutionStartResultStatus.AuthorizationRejected;
    case StartReviewExecutionStatus.IdempotencyConflict:
    case StartReviewExecutionStatus.RequestIntentConflict:
      return ReviewExecutionStartResultStatus.IdempotencyConflict;
    case StartReviewExecutionStatus.ConcurrencyConflict:
      return ReviewExecutionStartResultStatus.ConcurrencyConflict;
    case StartReviewExecutionStatus.AssignmentManifestRejected:
      throw new Error("assignment_manifest_rejection_not_mapped");
  }
}
export function mapLookup(
  status: LookupReviewEvidenceStatus,
): ReviewEvidenceLookupResultStatus {
  switch (status) {
    case LookupReviewEvidenceStatus.Hit:
      return ReviewEvidenceLookupResultStatus.Hit;
    case LookupReviewEvidenceStatus.Shadow:
      return ReviewEvidenceLookupResultStatus.Shadow;
    case LookupReviewEvidenceStatus.Miss:
      return ReviewEvidenceLookupResultStatus.Miss;
  }
}
export function mapCommit(
  status: AcceptReviewObservationStatus,
): ReviewEvidenceCommitResultStatus {
  switch (status) {
    case AcceptReviewObservationStatus.Accepted:
      return ReviewEvidenceCommitResultStatus.Accepted;
    case AcceptReviewObservationStatus.Idempotent:
      return ReviewEvidenceCommitResultStatus.Idempotent;
    case AcceptReviewObservationStatus.Rejected:
      return ReviewEvidenceCommitResultStatus.Rejected;
    case AcceptReviewObservationStatus.Conflict:
      return ReviewEvidenceCommitResultStatus.Conflict;
  }
}
export function mapInvocationFlightAcquire(
  status: AcquireOrJoinInvocationFlightStatus,
) {
  switch (status) {
    case AcquireOrJoinInvocationFlightStatus.OwnerAcquired:
    case AcquireOrJoinInvocationFlightStatus.TakenOver:
      return ReviewInvocationLeaseResultStatus.Acquired;
    case AcquireOrJoinInvocationFlightStatus.OwnerRestored:
      return ReviewInvocationLeaseResultStatus.Restored;
    case AcquireOrJoinInvocationFlightStatus.Joined:
    case AcquireOrJoinInvocationFlightStatus.Busy:
    case AcquireOrJoinInvocationFlightStatus.CrossRevisionJoinForbidden:
      return ReviewInvocationLeaseResultStatus.Busy;
    case AcquireOrJoinInvocationFlightStatus.Missing:
      return ReviewInvocationLeaseResultStatus.Missing;
    case AcquireOrJoinInvocationFlightStatus.InputStale:
    case AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted:
    case AcquireOrJoinInvocationFlightStatus.NotRunnable:
    case AcquireOrJoinInvocationFlightStatus.IdempotencyConflict:
      return ReviewInvocationLeaseResultStatus.Rejected;
  }
}
export function mapInvocationFlightAcquireRejectionReason(
  status: AcquireOrJoinInvocationFlightStatus,
) {
  switch (status) {
    case AcquireOrJoinInvocationFlightStatus.InputStale:
    case AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted:
    case AcquireOrJoinInvocationFlightStatus.NotRunnable:
    case AcquireOrJoinInvocationFlightStatus.IdempotencyConflict:
      return status;
    default:
      return null;
  }
}
export function leaseTransitionResult(
  status: ReviewInvocationLeaseTransitionStatus,
  lease?: ReviewInvocationLease,
) {
  return {
    status:
      status === ReviewInvocationLeaseTransitionStatus.Applied
        ? ReviewInvocationLeaseResultStatus.Applied
        : status === ReviewInvocationLeaseTransitionStatus.Restored
          ? ReviewInvocationLeaseResultStatus.Restored
          : status === ReviewInvocationLeaseTransitionStatus.StaleTerm
            ? ReviewInvocationLeaseResultStatus.StaleTerm
            : status === ReviewInvocationLeaseTransitionStatus.Expired
              ? ReviewInvocationLeaseResultStatus.Expired
              : status === ReviewInvocationLeaseTransitionStatus.Missing
                ? ReviewInvocationLeaseResultStatus.Missing
                : ReviewInvocationLeaseResultStatus.Rejected,
    leaseId: lease?.leaseId ?? null,
    fencingToken: lease?.fencingToken.toString(10) ?? null,
    expiresAt: lease?.expiresAt.toISOString() ?? null,
  };
}
