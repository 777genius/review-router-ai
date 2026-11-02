import {
  OutboxHandlerError,
  type OutboxHandler,
  type OutboxHandlerDefinition,
} from "@reviewrouter/features-outbox";
import {
  HistoryCollisionError,
  HistoryEventValidationError,
  historyChangedEventType,
  historyChangedEventVersion,
  parseHistoryChangedEvent,
  type HistoryProjector,
} from "@reviewrouter/features-review-history";
export const reviewHistoryHandlerDefinition = {
  type: historyChangedEventType,
  version: historyChangedEventVersion,
} as const satisfies OutboxHandlerDefinition;
/** Draining accepted immutable facts is independent of capture/UI/publisher configuration. */
export function createReviewHistoryChangedHandler(
  projector: HistoryProjector,
): OutboxHandler {
  return {
    ...reviewHistoryHandlerDefinition,
    async handle(event) {
      try {
        const payload = parseHistoryChangedEvent(event.payload);
        if (
          event.type !== historyChangedEventType ||
          event.version !== historyChangedEventVersion ||
          event.aggregateId !== payload.run.rootRequestId ||
          event.workspaceId !== payload.run.workspaceId ||
          event.repositoryId !== payload.run.originalRepositoryConnectionId
        )
          throw new HistoryEventValidationError();
        await projector.project(payload);
      } catch (error) {
        if (
          error instanceof HistoryEventValidationError ||
          error instanceof HistoryCollisionError
        )
          throw new OutboxHandlerError(
            "Invalid immutable review history event",
            error.code,
            false,
          );
        throw error;
      }
    },
  };
}
