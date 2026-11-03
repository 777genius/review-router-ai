import { reviewPublicationAttemptId } from "../services/review-publication-operation-planning-service";
import type {
  CurrentPublicationLifecycleFacts,
  CurrentPublicationLifecycleFactsPort,
} from "../ports/current-publication-lifecycle-facts-port";
import {
  ReviewPublicationLifecycleExpectationStatus,
  type CurrentPublicationLifecyclePort,
  type LiveReviewPublicationLifecyclePort,
  type ReviewPublicationAttemptQueryPort,
  type ReviewPublicationAttemptView,
  type ReviewPublicationLifecycleExpectationDecision,
  type ReviewPublicationResolutionHistoryPort,
} from "../ports/review-publication-ports";
import { bindOwnPublicationResolutionOperations } from "./bind-own-publication-resolution-operations";
import {
  ResolveCurrentPublicationLifecycle,
  reviewPublicationLifecycleExpectationFromProjection,
} from "./resolve-current-publication-lifecycle";

/** One aggregate lifecycle policy for request admission and fresh worker effects. */
export class ResolvePersistedPublicationLifecycle implements CurrentPublicationLifecyclePort {
  constructor(
    private readonly dependencies: Readonly<{
      facts: CurrentPublicationLifecycleFactsPort;
      live: LiveReviewPublicationLifecyclePort;
      digestUtf8: (value: string) => string;
      publications?: Pick<
        ReviewPublicationAttemptQueryPort,
        "findByPermitIdentity"
      >;
      resolutionHistory?: ReviewPublicationResolutionHistoryPort;
    }>,
  ) {}

  async resolve(
    scope: Parameters<CurrentPublicationLifecyclePort["resolve"]>[0],
  ) {
    let expectation: ReviewPublicationLifecycleExpectationDecision;
    let requireResolutionHistory = false;
    try {
      const facts = await this.dependencies.facts.readCurrent(scope);
      if (!facts) {
        expectation = {
          status: ReviewPublicationLifecycleExpectationStatus.Missing,
        };
      } else {
        requireResolutionHistory =
          facts.authorization.requiresResolutionHistory;
        try {
          expectation = reviewPublicationLifecycleExpectationFromProjection({
            ...facts.artifact,
            legacyObservationBoundary: facts.authorization.createdAt,
          });
        } catch {
          expectation = {
            status: ReviewPublicationLifecycleExpectationStatus.Invalid,
          };
        }
        if (
          requireResolutionHistory &&
          expectation.status ===
            ReviewPublicationLifecycleExpectationStatus.Available
        ) {
          if (
            !this.dependencies.resolutionHistory ||
            !this.dependencies.publications
          )
            throw new Error("resolution_history_ports_unavailable");
          const view = exactPublication(
            facts,
            await this.dependencies.publications.findByPermitIdentity(
              facts.artifact.publicationPermit,
            ),
            this.dependencies.digestUtf8,
          );
          expectation = bindOwnPublicationResolutionOperations(
            expectation,
            view,
            this.dependencies.digestUtf8,
          );
        }
      }
    } catch {
      expectation = {
        status: ReviewPublicationLifecycleExpectationStatus.Unavailable,
      };
    }
    const history = this.dependencies.resolutionHistory;
    return new ResolveCurrentPublicationLifecycle({
      expectations: { resolve: async () => expectation },
      live: this.dependencies.live,
      ...(requireResolutionHistory && history
        ? {
            resolutionHistory: {
              async read(historyScope, threadIds) {
                // Ordinary discovery has no resolution effect and needs no fleet activation.
                if (threadIds.length === 0) return [];
                const histories = await history.read(historyScope, threadIds);
                if (
                  !Array.isArray(histories) ||
                  histories.some((item) => item.historyCut === null)
                )
                  throw new Error("resolution_history_activation_unavailable");
                return histories;
              },
            } satisfies ReviewPublicationResolutionHistoryPort,
          }
        : {}),
    }).resolve(scope);
  }
}

/** A current plan or matching thread cannot establish ownership of a previous effect. */
function exactPublication(
  facts: CurrentPublicationLifecycleFacts,
  view: ReviewPublicationAttemptView | null,
  digestUtf8: (value: string) => string,
): ReviewPublicationAttemptView | null {
  const { artifact, execution } = facts;
  if (
    !execution ||
    artifact.executionId !== execution.executionId ||
    artifact.generation !== execution.generation ||
    artifact.reviewedHeadSha !== execution.reviewedHeadSha ||
    artifact.reviewRevisionHash !== execution.reviewRevisionHash
  )
    throw new Error("restore_artifact_scope_mismatch");
  const expectedAttemptId = reviewPublicationAttemptId({
    executionId: artifact.executionId,
    artifactId: artifact.artifactId,
    projectionHash: artifact.projectionHash,
    digestUtf8,
  });
  // The first request has no persisted publication and therefore no own-operation exception.
  if (!view) return null;
  const { attempt } = view;
  if (
    attempt.publicationAttemptId !== expectedAttemptId ||
    attempt.permit.executionId !== artifact.executionId ||
    attempt.permit.generation !== artifact.generation ||
    attempt.permit.projectionHash !== artifact.projectionHash ||
    attempt.permit.reviewedHeadSha !== artifact.reviewedHeadSha ||
    attempt.permit.reviewRevisionHash !== artifact.reviewRevisionHash
  )
    throw new Error("restore_publication_scope_mismatch");
  return view;
}
