import type {
  ReviewPublicationAttemptView,
  ReviewPublicationLifecycleExpectationDecision,
} from "../ports/review-publication-ports";
import { ReviewPublicationLifecycleExpectationStatus } from "../ports/review-publication-ports";
import { canonicalReviewPublicationJson } from "../../domain/canonical-review-publication-json";

/** The application supplies the existing canonical view; fresh planning cannot establish ownership. */
export function bindOwnPublicationResolutionOperations(
  expectation: ReviewPublicationLifecycleExpectationDecision,
  view: ReviewPublicationAttemptView | null,
  digestUtf8: (value: string) => string,
): ReviewPublicationLifecycleExpectationDecision {
  if (
    expectation.status !==
      ReviewPublicationLifecycleExpectationStatus.Available ||
    !view
  )
    return expectation;
  if (
    view.attempt.permit.reviewedHeadSha !== expectation.reviewedHeadSha ||
    view.attempt.permit.lifecycleStateHash !== expectation.lifecycleStateHash ||
    view.attempt.permit.commandLedgerWatermark !==
      expectation.commandLedgerWatermark
  )
    throw new Error("resolution_own_publication_scope_mismatch");
  return {
    ...expectation,
    targets: expectation.targets.map((target) => {
      if (!target.mutationEligible) return target;
      const bodyHash = digestUtf8(
        canonicalReviewPublicationJson({
          resolve: true,
          threadId: target.threadId,
        }),
      );
      const markerHash = digestUtf8(
        `reviewrouter-lifecycle:${target.targetId}:resolved`,
      );
      const matches = view.attempt.operations.filter(
        (operation) =>
          operation.publicationKind === "thread_lifecycle" &&
          operation.targetCommitId === expectation.reviewedHeadSha &&
          operation.reviewRevisionHash ===
            view.attempt.permit.reviewRevisionHash &&
          operation.bodyHash === bodyHash &&
          operation.markerHash === markerHash,
      );
      if (matches.length !== 1) return target;
      return {
        ...target,
        ownResolutionOperation: {
          sourceKind: "canonical_operation" as const,
          operationId: matches[0]!.publicationOperationId,
          publicationAttemptId: view.attempt.publicationAttemptId,
          executionId: view.attempt.permit.executionId,
          generation: view.attempt.permit.generation.toString(),
          reviewedHeadSha: expectation.reviewedHeadSha,
          bodyHash,
        },
      };
    }),
  };
}
