import {
  OutboxHandlerError,
  type OutboxHandler,
  type OutboxHandlerDefinition,
} from "@reviewrouter/features-outbox";
import {
  StatisticsCollisionError,
  StatisticsValidationError,
  parseReviewStatisticsSettledEvent,
  reviewStatisticsSettledEventType,
  reviewStatisticsSettledEventVersion,
  type ReviewStatisticsProjector,
} from "@reviewrouter/features-review-statistics";

export const reviewStatisticsHandlerDefinition = {
  type: reviewStatisticsSettledEventType,
  version: reviewStatisticsSettledEventVersion,
} as const satisfies OutboxHandlerDefinition;

/** Always registered: draining already accepted facts needs no publisher credentials. */
export function createReviewStatisticsSettledHandler(
  projector: ReviewStatisticsProjector,
): OutboxHandler {
  return {
    ...reviewStatisticsHandlerDefinition,
    async handle(event) {
      try {
        const payload = parseReviewStatisticsSettledEvent(event.payload);
        if (
          event.type !== reviewStatisticsSettledEventType ||
          event.version !== reviewStatisticsSettledEventVersion ||
          event.aggregateId !== payload.executionId ||
          event.workspaceId !== payload.workspaceId ||
          event.repositoryId !== payload.repositoryConnectionId
        )
          throw new StatisticsValidationError();
        await projector.project(payload);
      } catch (error) {
        if (
          error instanceof StatisticsValidationError ||
          error instanceof StatisticsCollisionError
        ) {
          throw new OutboxHandlerError(
            "Invalid immutable statistics event",
            error.code,
            false,
          );
        }
        throw error;
      }
    },
  };
}
