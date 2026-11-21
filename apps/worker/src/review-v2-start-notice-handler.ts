import {
  ReviewRequestedStartNotice,
  reviewRequestedStartNoticeEvent,
  reviewRequestedStartNoticeEventType,
  reviewRequestedStartNoticeEventVersion,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedIntent,
  type ReviewRequestedIntentQueryPort,
  type ReviewRequestedNewerRequestQueryPort,
} from "@reviewrouter/features-review-executions";
import {
  OutboxHandlerError,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";

export type ReviewRequestedStartNoticePublication = Readonly<{
  intent: ReviewRequestedIntent;
  notice: ReviewRequestedStartNotice;
  /**
   * For "not started": whether GitHub ever gave the run a runner. A run that
   * got one but never reached ReviewRouter is not a runner shortage.
   */
  runnerAssigned: boolean;
}>;

/** Writes a start notice into the pull request's progress comment. */
export type ReviewRequestedStartNoticePublisherPort = {
  /** `busy` while live progress of the pull request is being published. */
  publish(
    input: ReviewRequestedStartNoticePublication,
  ): Promise<"published" | "skipped" | "busy">;
};

/**
 * Plan 88: tells the pull request that its review waits for a GitHub runner,
 * or that it stopped before a run reached ReviewRouter. It speaks only while
 * the request is still in the state the notice describes, no newer review
 * request for the pull request exists and the pull request still shows the
 * revision; "waiting" also needs every job still queued without a runner.
 * A stop always gets its status, so a "waiting" text never outlives its run.
 */
export function createReviewRequestedStartNoticeHandler(dependencies: {
  readonly intents: Pick<ReviewRequestedIntentQueryPort, "findByRequestId"> &
    ReviewRequestedNewerRequestQueryPort;
  readonly gateway: Pick<
    ReviewRequestedDispatchGatewayPort,
    "inspectRunnerWait"
  >;
  /** `null` when progress comment writes are off. */
  readonly publisher: ReviewRequestedStartNoticePublisherPort | null;
}): OutboxHandler {
  return {
    type: reviewRequestedStartNoticeEventType,
    version: reviewRequestedStartNoticeEventVersion,
    async handle(event) {
      const payload = event.payload;
      if (!isRecord(payload) || typeof payload.requestId !== "string") {
        throw failure("start_notice_payload_invalid", false);
      }
      if (dependencies.publisher === null) return;
      const intent = await dependencies.intents
        .findByRequestId(payload.requestId)
        .catch(() => {
          throw failure("start_notice_intent_read_unavailable");
        });
      // The request moved on (a run reached it, it stopped, or it was pruned):
      // this notice no longer describes it.
      const current = intent && reviewRequestedStartNoticeEvent(intent);
      if (
        !intent ||
        !current ||
        current.idempotencyKey !== event.idempotencyKey
      )
        return;
      if (
        event.aggregateId !== current.aggregateId ||
        event.workspaceId !== current.workspaceId ||
        event.repositoryId !== current.repositoryId
      ) {
        throw failure("start_notice_identity_conflict", false);
      }
      const newer = await dependencies.intents
        .hasNewerRequestInScope(intent)
        .catch(() => {
          throw failure("start_notice_newer_request_unavailable");
        });
      if (newer) return;
      const runner = await dependencies.gateway
        .inspectRunnerWait({ intent })
        .catch(() => {
          throw failure("start_notice_runner_inspection_unavailable");
        });
      const notice = current.payload.notice;
      if (
        !runner.revisionCurrent ||
        (notice === ReviewRequestedStartNotice.WaitingForRunner &&
          !runner.waitingForRunner)
      )
        return;
      const published = await dependencies.publisher
        .publish({ intent, notice, runnerAssigned: !runner.neverStarted })
        .catch(() => {
          throw failure("start_notice_publication_failed");
        });
      if (published === "busy") throw failure("start_notice_progress_busy");
    },
  };
}

function failure(code: string, retryable = true) {
  return new OutboxHandlerError(code, code, retryable);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
