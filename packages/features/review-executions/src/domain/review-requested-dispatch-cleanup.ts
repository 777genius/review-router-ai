import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  type ReviewRequestedIntent,
} from "./review-requested-intent";

export const reviewRequestedDispatchCleanupEventType =
  "review.requested_dispatch_cleanup";
export const reviewRequestedDispatchCleanupEventVersion = 1;

/**
 * A durable obligation, separate from the original dispatch resolution window.
 * These terminal reasons leave a submitted run unresolved; proven no-effect and
 * completed-run recovery must not create cancellation retry obligations.
 */
export function reviewRequestedDispatchCleanupEvent(
  intent: ReviewRequestedIntent,
) {
  if (
    (intent.state !== ReviewRequestedIntentState.Superseded &&
      !(
        intent.state === ReviewRequestedIntentState.Terminal &&
        (intent.terminalReason ===
          ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown ||
          intent.terminalReason ===
            ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded)
      )) ||
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
