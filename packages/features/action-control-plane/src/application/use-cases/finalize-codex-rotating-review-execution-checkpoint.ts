import {
  finalizeReviewExecutionCheckpoint,
  type ReviewExecutionCheckpointRepositoryPort,
} from "@reviewrouter/features-review-execution-checkpoints";
import type { Clock } from "@reviewrouter/shared";
import type { CodexRotatingReviewExecutionCheckpointAccessPort } from "../ports/codex-rotating-review-execution-checkpoint-access-port.js";

export type FinalizeCodexRotatingReviewExecutionCheckpointDependencies = {
  readonly codexRotatingReviewExecutionCheckpointAccess: CodexRotatingReviewExecutionCheckpointAccessPort;
  readonly reviewExecutionCheckpoints: ReviewExecutionCheckpointRepositoryPort;
  readonly clock: Clock;
};

export async function finalizeCodexRotatingReviewExecutionCheckpoint(
  input: {
    readonly leaseId: string;
    readonly providerInstanceId: string;
    readonly pullRequestNumber: number;
    readonly expectedVersion: number;
    readonly headSha: string;
    readonly planHash: string;
  },
  dependencies: FinalizeCodexRotatingReviewExecutionCheckpointDependencies,
) {
  const now = dependencies.clock.now();
  return dependencies.codexRotatingReviewExecutionCheckpointAccess.withAuthorizedReviewExecutionCheckpointAccess(
    {
      leaseId: input.leaseId,
      providerInstanceId: input.providerInstanceId,
      pullRequestNumber: input.pullRequestNumber,
      now,
    },
    async (scope) =>
      finalizeReviewExecutionCheckpoint(
        {
          scope: {
            workspaceId: scope.workspaceId,
            repositoryId: scope.repositoryId,
            pullRequestNumber: input.pullRequestNumber,
          },
          expectedVersion: input.expectedVersion,
          headSha: input.headSha,
          planHash: input.planHash,
        },
        { checkpoints: dependencies.reviewExecutionCheckpoints, now },
      ),
  );
}
