import {
  ensureResolutionHistoryActivated,
  type ResolutionHistoryActivationStatePort,
  type ResolutionWriterDrainQualificationPort,
  type ReviewPublicationResolutionHistoryPort,
  type ReviewPublicationScope,
} from "@reviewrouter/features-review-publishing/v2";

export type EnsureReviewResolutionHistory = (
  scope: ReviewPublicationScope,
) => ReturnType<typeof ensureResolutionHistoryActivated>;

export function prepareReviewResolutionHistory(input: {
  readonly history: ResolutionHistoryActivationStatePort &
    ReviewPublicationResolutionHistoryPort;
  readonly writers: ResolutionWriterDrainQualificationPort;
}): {
  ensure: EnsureReviewResolutionHistory;
  history: ReviewPublicationResolutionHistoryPort;
} {
  const ensure: EnsureReviewResolutionHistory = (scope) =>
    ensureResolutionHistoryActivated(scope, {
      activation: input.history,
      writers: input.writers,
    });
  return {
    ensure,
    history: {
      async read(scope, threadIds) {
        // No fresh resolution is requested; missing fleet evidence must not block discovery publication.
        if (threadIds.length === 0) return [];
        if ((await ensure(scope)).status !== "guarded")
          throw new Error("resolution_history_unavailable");
        return input.history.read(scope, threadIds);
      },
    },
  };
}
