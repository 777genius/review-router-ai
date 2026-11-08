import { createHash } from "node:crypto";
import type { ReviewExecutionQueryPort } from "@reviewrouter/features-review-executions";
import {
  ResolvePersistedPublicationLifecycle,
  type CurrentPublicationLifecyclePort,
  type LiveReviewPublicationLifecyclePort,
  type ReviewPublicationAttemptQueryPort,
  type ReviewPublicationResolutionHistoryPort,
  type CurrentPublicationLifecycleFactsPort,
} from "@reviewrouter/features-review-publishing/v2";
import {
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorizationQueryPort,
} from "@reviewrouter/features-review-run-control";

export function createWorkerPublicationLifecyclePort(input: {
  readonly executions: Pick<
    ReviewExecutionQueryPort,
    "findStream" | "findExecution"
  >;
  readonly authorizationQueries: Pick<
    ReviewRunAuthorizationQueryPort,
    "findReviewRunAuthorizationById"
  >;
  readonly liveLifecycle: LiveReviewPublicationLifecyclePort;
  readonly publications?: Pick<
    ReviewPublicationAttemptQueryPort,
    "findByPermitIdentity"
  >;
  readonly resolutionHistory?: ReviewPublicationResolutionHistoryPort;
}): CurrentPublicationLifecyclePort {
  return new ResolvePersistedPublicationLifecycle({
    facts: createWorkerPublicationLifecycleFacts({
      executions: input.executions,
      authorizations: input.authorizationQueries,
    }),
    live: input.liveLifecycle,
    digestUtf8: (value) => createHash("sha256").update(value).digest("hex"),
    ...(input.publications ? { publications: input.publications } : {}),
    ...(input.resolutionHistory
      ? { resolutionHistory: input.resolutionHistory }
      : {}),
  });
}

/** Translate other contexts' persisted facts; lifecycle admission belongs to publication. */
function createWorkerPublicationLifecycleFacts(input: {
  readonly executions: Pick<
    ReviewExecutionQueryPort,
    "findStream" | "findExecution"
  >;
  readonly authorizations: Pick<
    ReviewRunAuthorizationQueryPort,
    "findReviewRunAuthorizationById"
  >;
}): CurrentPublicationLifecycleFactsPort {
  return {
    async readCurrent(scope) {
      const stream = await input.executions.findStream(scope);
      const snapshot = stream?.activeExecutionId
        ? await input.executions.findExecution(stream.activeExecutionId)
        : null;
      const artifact = snapshot?.artifact;
      if (!artifact) return null;
      const authorization =
        await input.authorizations.findReviewRunAuthorizationById(
          artifact.publicationPermit.authorizationId,
        );
      if (!authorization) return null;
      return {
        execution: snapshot.execution
          ? {
              executionId: snapshot.execution.executionId,
              generation: snapshot.execution.generation,
              reviewedHeadSha: snapshot.execution.revision.headSha,
              reviewRevisionHash:
                snapshot.execution.revision.reviewRevisionHash,
            }
          : null,
        artifact: {
          artifactId: artifact.artifactId,
          executionId: artifact.executionId,
          generation: artifact.generation,
          reviewedHeadSha: artifact.reviewedHeadSha,
          reviewRevisionHash: artifact.reviewRevisionHash,
          projectionHash: artifact.projectionHash,
          projectionEnvelopeJson: artifact.projectionEnvelopeJson,
          lifecycleStateHash: artifact.lifecycleStateHash,
          commandLedgerWatermark: artifact.commandLedgerWatermark,
          publicationPermit: artifact.publicationPermit,
        },
        authorization: {
          createdAt: authorization.createdAt,
          requiresResolutionHistory: !!parseReviewRunRuntimeSnapshot(
            authorization.runtimeSnapshotCanonicalJson,
          )?.lifecycleVerificationCapability,
        },
      };
    },
  };
}
