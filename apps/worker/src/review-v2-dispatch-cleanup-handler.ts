import {
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  reviewRequestedDispatchCleanupEvent,
  reviewRequestedDispatchCleanupEventType,
  reviewRequestedDispatchCleanupEventVersion,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedIntentQueryPort,
} from "@reviewrouter/features-review-executions";
import {
  OutboxHandlerError,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";

export function createReviewRequestedDispatchCleanupHandler(dependencies: {
  readonly intents: Pick<ReviewRequestedIntentQueryPort, "findByRequestId">;
  readonly gateway: ReviewRequestedDispatchGatewayPort;
}): OutboxHandler {
  return {
    type: reviewRequestedDispatchCleanupEventType,
    version: reviewRequestedDispatchCleanupEventVersion,
    async handle(event) {
      const payload = event.payload;
      if (!isRecord(payload) || typeof payload.requestId !== "string") {
        throw failure("dispatch_cleanup_payload_invalid", false);
      }
      const intent = await dependencies.intents
        .findByRequestId(payload.requestId)
        .catch(() => {
          throw failure("dispatch_cleanup_intent_read_unavailable");
        });
      if (!intent) throw failure("dispatch_cleanup_intent_missing");
      const expected = reviewRequestedDispatchCleanupEvent(intent);
      // Supersession and admission compete on the persisted version. Once
      // superseded, admission cannot succeed; do not cancel an admitted drain.
      if (
        !expected ||
        event.type !== expected.type ||
        event.version !== expected.version ||
        event.idempotencyKey !== expected.idempotencyKey ||
        event.workspaceId !== expected.workspaceId ||
        event.repositoryId !== expected.repositoryId ||
        event.aggregateId !== expected.aggregateId ||
        !Object.entries(expected.payload).every(
          ([key, value]) => payload[key] === value,
        )
      )
        throw failure("dispatch_cleanup_identity_conflict", false);

      let target = intent;
      if (target.sourceRunId === null || target.sourceRunAttempt === null) {
        // A dispatch POST may still be in flight. Even an absent lookup after
        // its original deadline is NOT proof of no effect; retry or retain DLQ.
        const found = await dependencies.gateway
          .findByRequestIdentity({ intent })
          .catch(() => {
            throw failure("dispatch_cleanup_lookup_unavailable");
          });
        if (found.status !== ReviewRequestedDispatchLookupStatus.Found) {
          throw failure("dispatch_cleanup_run_unresolved");
        }
        if (found.sourceRunAttempt !== "1") {
          throw failure("dispatch_cleanup_attempt_changed", false);
        }
        target = {
          ...intent,
          sourceRunId: found.sourceRunId,
          sourceRunAttempt: found.sourceRunAttempt,
        };
      }
      try {
        if (
          (await dependencies.gateway.inspectKnownRun({ intent: target }))
            .status !== ReviewRequestedDispatchRunStatus.Pending
        )
          return;
        try {
          await dependencies.gateway.cancelKnownRun({ intent: target });
        } catch {
          // Concurrent completion or a lost cancel response is resolved by the
          // same exact-run readback, never by acknowledging the POST response.
        }
        if (
          (await dependencies.gateway.inspectKnownRun({ intent: target }))
            .status === ReviewRequestedDispatchRunStatus.Pending
        ) {
          throw failure("dispatch_cleanup_not_terminal");
        }
      } catch {
        throw failure("dispatch_cleanup_not_terminal");
      }
    },
  };
}

function failure(code: string, retryable = true) {
  return new OutboxHandlerError(code, code, retryable);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
