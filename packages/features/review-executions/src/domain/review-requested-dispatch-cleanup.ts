import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  type ReviewRequestedIntent,
} from "./review-requested-intent";

export const reviewRequestedDispatchCleanupEventType =
  "review.requested_dispatch_cleanup";
export const reviewRequestedDispatchCleanupEventVersion = 1;

/** A durable obligation, separate from the original dispatch resolution window. */
export function reviewRequestedDispatchCleanupEvent(
  intent: ReviewRequestedIntent,
) {
  if (
    intent.state !== ReviewRequestedIntentState.Superseded ||
    intent.admission.state === ReviewRequestAdmissionState.Admitted ||
    intent.submissionStartedAt === null ||
    intent.authorizationId !== null ||
    intent.executionId !== null
  )
    return null;
  return {
    type: reviewRequestedDispatchCleanupEventType,
    version: reviewRequestedDispatchCleanupEventVersion,
    idempotencyKey: `${reviewRequestedDispatchCleanupEventType}:${intent.requestId}`,
    workspaceId: intent.workspaceId,
    repositoryId: intent.repositoryConnectionId,
    aggregateId: intent.requestId,
    payload: {
      requestId: intent.requestId,
      scmRepositoryIdentityId: intent.scmRepositoryIdentityId,
      pullRequestNumber: intent.pullRequestNumber,
      canonicalRequestHash: intent.canonicalRequestHash,
      submissionStartedAt: intent.submissionStartedAt.toISOString(),
      sourceRunId: intent.sourceRunId,
      sourceRunAttempt: intent.sourceRunAttempt,
    },
    // Eventual run visibility, cancellation, and crash recovery use the existing
    // bounded outbox backoff. Exhaustion retains a dead-letter, never no-effect.
    maxAttempts: 20,
    occurredAt: intent.updatedAt,
  } as const;
}
