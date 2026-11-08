import { describe, expect, it } from "vitest";
import {
  AcceptReviewObservationStatus,
  LookupReviewEvidenceStatus,
} from "@reviewrouter/features-review-evidence";
import {
  AcquireOrJoinInvocationFlightStatus,
  ReviewExecutionFinalizeStatus,
  ReviewInvocationLeaseTransitionStatus,
  StartReviewExecutionStatus,
} from "@reviewrouter/features-review-executions";
import {
  ReviewEvidenceCommitResultStatus,
  ReviewEvidenceLookupResultStatus,
  ReviewExecutionMutationResultStatus,
  ReviewExecutionStartResultStatus,
  ReviewInvocationLeaseResultStatus,
} from "@reviewrouter/protocol-review-action-v2";
import {
  leaseTransitionResult,
  mapCommit,
  mapFinalize,
  mapInvocationFlightAcquire,
  mapInvocationFlightAcquireRejectionReason,
  mapLookup,
  mapStart,
} from "./review-action-v2-execution-result-mappers.js";

describe("Review Action v2 response mapping", () => {
  it("retains admission and conflict decisions", () => {
    expect(mapStart(StartReviewExecutionStatus.Admitted)).toBe(
      ReviewExecutionStartResultStatus.Admitted,
    );
    expect(mapStart(StartReviewExecutionStatus.RequestIntentMissing)).toBe(
      ReviewExecutionStartResultStatus.AuthorizationRejected,
    );
    expect(mapStart(StartReviewExecutionStatus.RequestIntentConflict)).toBe(
      ReviewExecutionStartResultStatus.IdempotencyConflict,
    );
    expect(() =>
      mapStart(StartReviewExecutionStatus.AssignmentManifestRejected),
    ).toThrow("assignment_manifest_rejection_not_mapped");
  });

  it("retains finalized, restored and rejected protocol results", () => {
    expect(mapFinalize(ReviewExecutionFinalizeStatus.Finalized)).toBe(
      ReviewExecutionMutationResultStatus.Applied,
    );
    expect(mapFinalize(ReviewExecutionFinalizeStatus.Restored)).toBe(
      ReviewExecutionMutationResultStatus.Restored,
    );
    expect(mapLookup(LookupReviewEvidenceStatus.Shadow)).toBe(
      ReviewEvidenceLookupResultStatus.Shadow,
    );
    expect(mapCommit(AcceptReviewObservationStatus.Idempotent)).toBe(
      ReviewEvidenceCommitResultStatus.Idempotent,
    );
  });

  it("distinguishes lease busy, restored, rejected and stale fencing", () => {
    expect(
      mapInvocationFlightAcquire(
        AcquireOrJoinInvocationFlightStatus.CrossRevisionJoinForbidden,
      ),
    ).toBe(ReviewInvocationLeaseResultStatus.Busy);
    expect(
      mapInvocationFlightAcquire(
        AcquireOrJoinInvocationFlightStatus.OwnerRestored,
      ),
    ).toBe(ReviewInvocationLeaseResultStatus.Restored);
    expect(
      mapInvocationFlightAcquire(
        AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted,
      ),
    ).toBe(ReviewInvocationLeaseResultStatus.Rejected);
    expect(
      mapInvocationFlightAcquireRejectionReason(
        AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
      ),
    ).toBeNull();
    expect(
      mapInvocationFlightAcquireRejectionReason(
        AcquireOrJoinInvocationFlightStatus.InputStale,
      ),
    ).toBe(AcquireOrJoinInvocationFlightStatus.InputStale);
    expect(
      leaseTransitionResult(ReviewInvocationLeaseTransitionStatus.StaleTerm),
    ).toEqual({
      status: ReviewInvocationLeaseResultStatus.StaleTerm,
      leaseId: null,
      fencingToken: null,
      expiresAt: null,
    });
  });
});
