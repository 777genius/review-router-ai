import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  type ReviewRequestedIntent,
} from "./review-requested-intent";

export const reviewRequestedStartNoticeEventType =
  "review.requested_start_notice";
export const reviewRequestedStartNoticeEventVersion = 1;

/** What the pull request is told about a run that has no runner (plan 88). */
export enum ReviewRequestedStartNotice {
  /** The run is still queued after its first window; it starts by itself. */
  WaitingForRunner = "waiting_for_runner",
  /** The request stopped at its deadline before any run reached it. */
  NotStarted = "not_started",
}

/**
 * The status a request owes its pull request instead of silence while no run
 * has reached it: "waiting" once its window was extended, "not started" once
 * it stopped at the deadline. The handler checks GitHub before it says that a
 * run has no runner, and stays silent when the request moved on.
 */
export function reviewRequestedStartNoticeEvent(intent: ReviewRequestedIntent) {
  if (
    intent.admission.state !== ReviewRequestAdmissionState.NotEvaluated ||
    intent.sourceRunId === null ||
    intent.sourceRunAttempt === null ||
    intent.authorizationId !== null ||
    intent.executionId !== null
  )
    return null;
  const notice =
    intent.state === ReviewRequestedIntentState.AwaitingAuthorization
      ? ReviewRequestedStartNotice.WaitingForRunner
      : intent.state === ReviewRequestedIntentState.Terminal &&
          intent.terminalReason ===
            ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded
        ? ReviewRequestedStartNotice.NotStarted
        : null;
  if (notice === null) return null;
  return {
    type: reviewRequestedStartNoticeEventType,
    version: reviewRequestedStartNoticeEventVersion,
    idempotencyKey: `${reviewRequestedStartNoticeEventType}:${notice}:${intent.requestId}`,
    workspaceId: intent.workspaceId,
    repositoryId: intent.repositoryConnectionId,
    aggregateId: intent.requestId,
    payload: { requestId: intent.requestId, notice },
    // With the outbox backoff this waits about an hour for a busy progress comment.
    maxAttempts: 20,
    occurredAt: intent.updatedAt,
  } as const;
}
