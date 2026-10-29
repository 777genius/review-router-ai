import {
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedTransitionStatus,
  reviewRequestedDispatchCleanupEvent,
  reviewRequestedDispatchCleanupEventType,
  reviewRequestedDispatchCleanupEventVersion,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedIntentQueryPort,
  type ReviewRequestedDispatchCleanupTargetPort,
} from "@reviewrouter/features-review-executions";
import {
  OutboxHandlerError,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";

export function createReviewRequestedDispatchCleanupHandler(dependencies: {
  readonly intents: Pick<ReviewRequestedIntentQueryPort, "findByRequestId"> &
    ReviewRequestedDispatchCleanupTargetPort;
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
      // Only eligible closed pre-admission work can be cleaned up. The original
      // NULL/NULL event target remains immutable when late discovery binds it.
      if (
        !expected ||
        event.type !== expected.type ||
        event.version !== expected.version ||
        event.idempotencyKey !== expected.idempotencyKey ||
        event.workspaceId !== expected.workspaceId ||
        event.repositoryId !== expected.repositoryId ||
        event.aggregateId !== expected.aggregateId ||
        !sameCoreIdentity(payload, expected.payload) ||
        !(
          (payload.sourceRunId === null && payload.sourceRunAttempt === null) ||
          (payload.sourceRunId === expected.payload.sourceRunId &&
            payload.sourceRunAttempt === expected.payload.sourceRunAttempt)
        )
      )
        throw failure("dispatch_cleanup_identity_conflict", false);

      let target = intent;
      if ((target.sourceRunId === null) !== (target.sourceRunAttempt === null))
        throw failure("dispatch_cleanup_target_partial", false);
      if (target.sourceRunId === null) {
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
        const observedVersion = intent.version;
        const observedState = intent.state;
        const observedReason = intent.terminalReason;
        const observedAdmission = intent.admission.state;
        const bound = await dependencies.intents
          .bindCleanupRunTarget({
            requestId: intent.requestId,
            expectedVersion: observedVersion,
            sourceRunId: found.sourceRunId,
            sourceRunAttempt: found.sourceRunAttempt,
          })
          .catch(() => {
            throw failure("dispatch_cleanup_target_binding_unavailable");
          });
        const persisted = bound.intent;
        const persistedEvent =
          persisted && reviewRequestedDispatchCleanupEvent(persisted);
        if (
          !persisted ||
          !persistedEvent ||
          (bound.status !== ReviewRequestedTransitionStatus.Applied &&
            bound.status !== ReviewRequestedTransitionStatus.Restored) ||
          persisted.version <= observedVersion ||
          (bound.status === ReviewRequestedTransitionStatus.Applied &&
            persisted.version !== observedVersion + 1n) ||
          persisted.state !== observedState ||
          persisted.terminalReason !== observedReason ||
          persisted.admission.state !== observedAdmission ||
          persisted.sourceRunId !== found.sourceRunId ||
          persisted.sourceRunAttempt !== "1" ||
          persistedEvent.workspaceId !== expected.workspaceId ||
          persistedEvent.repositoryId !== expected.repositoryId ||
          persistedEvent.aggregateId !== expected.aggregateId ||
          !sameCoreIdentity(persistedEvent.payload, expected.payload)
        )
          throw failure("dispatch_cleanup_target_binding_conflict");
        target = persisted;
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

function sameCoreIdentity(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
) {
  return Object.entries(right).every(
    ([key, value]) =>
      key === "sourceRunId" ||
      key === "sourceRunAttempt" ||
      left[key] === value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
