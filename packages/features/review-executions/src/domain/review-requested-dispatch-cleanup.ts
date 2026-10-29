import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedTransitionDecisionStatus,
  type ReviewRequestedIntent,
  type ReviewRequestedTransitionDecision,
} from "./review-requested-intent";
import { assertDate, assertIdentifier } from "./review-execution";

export const reviewRequestedDispatchCleanupEventType =
  "review.requested_dispatch_cleanup";
export const reviewRequestedDispatchCleanupEventVersion = 1;

/** First discovered cleanup target is immutable across outbox retries. */
export function bindReviewRequestedDispatchCleanupTarget(input: {
  readonly intent: ReviewRequestedIntent;
  readonly expectedVersion: bigint;
  readonly sourceRunId: string;
  readonly sourceRunAttempt: string;
  readonly now: Date;
}): ReviewRequestedTransitionDecision {
  assertIdentifier(input.sourceRunId, "dispatch_cleanup_run_id");
  assertDate(input.now, "dispatch_cleanup_binding_time");
  const intent = input.intent;
  if (
    input.sourceRunAttempt !== "1" ||
    input.expectedVersion <= 0n ||
    input.expectedVersion > intent.version ||
    reviewRequestedDispatchCleanupEvent(intent) === null
  )
    return { status: ReviewRequestedTransitionDecisionStatus.Conflict };
  if (intent.sourceRunId !== null || intent.sourceRunAttempt !== null) {
    return intent.sourceRunId === input.sourceRunId &&
      intent.sourceRunAttempt === input.sourceRunAttempt
      ? { status: ReviewRequestedTransitionDecisionStatus.Restored, intent }
      : { status: ReviewRequestedTransitionDecisionStatus.Conflict };
  }
  if (intent.version !== input.expectedVersion)
    return { status: ReviewRequestedTransitionDecisionStatus.Conflict };
  return {
    status: ReviewRequestedTransitionDecisionStatus.Applied,
    intent: {
      ...intent,
      sourceRunId: input.sourceRunId,
      sourceRunAttempt: input.sourceRunAttempt,
      version: intent.version + 1n,
      updatedAt: new Date(input.now),
    },
  };
}

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
