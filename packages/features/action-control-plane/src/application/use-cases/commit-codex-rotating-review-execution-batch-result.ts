import {
  assertReviewExecutionCheckpointHeadAndPlan,
  commitReviewExecutionBatchResult,
  type ReviewExecutionBatchResultCandidate,
  type ReviewExecutionCheckpointRepositoryPort,
} from "@reviewrouter/features-review-execution-checkpoints";
import type { Clock } from "@reviewrouter/shared";
import type { CodexRotatingReviewExecutionCheckpointAccessPort } from "../ports/codex-rotating-review-execution-checkpoint-access-port.js";

export type CommitCodexRotatingReviewExecutionBatchResultInput = {
  readonly leaseId: string;
  readonly providerInstanceId: string;
  readonly pullRequestNumber: number;
  readonly expectedVersion: number;
  readonly headSha: string;
  readonly planHash: string;
  readonly candidate: Omit<
    ReviewExecutionBatchResultCandidate,
    "sourceRunId" | "sourceRunAttempt"
  >;
};

export type CommitCodexRotatingReviewExecutionBatchResultDependencies = {
  readonly codexRotatingReviewExecutionCheckpointAccess: CodexRotatingReviewExecutionCheckpointAccessPort;
  readonly reviewExecutionCheckpoints: ReviewExecutionCheckpointRepositoryPort;
  readonly clock: Clock;
};

export async function commitCodexRotatingReviewExecutionBatchResult(
  input: CommitCodexRotatingReviewExecutionBatchResultInput,
  dependencies: CommitCodexRotatingReviewExecutionBatchResultDependencies,
) {
  const now = dependencies.clock.now();
  return dependencies.codexRotatingReviewExecutionCheckpointAccess.withAuthorizedReviewExecutionCheckpointAccess(
    {
      leaseId: input.leaseId,
      providerInstanceId: input.providerInstanceId,
      pullRequestNumber: input.pullRequestNumber,
      now,
    },
    async (scope) => {
      assertReviewExecutionCheckpointHeadAndPlan(input);
      return commitReviewExecutionBatchResult(
        {
          scope: {
            workspaceId: scope.workspaceId,
            repositoryId: scope.repositoryId,
            pullRequestNumber: input.pullRequestNumber,
          },
          expectedVersion: input.expectedVersion,
          headSha: input.headSha,
          planHash: input.planHash,
          candidate: {
            ...input.candidate,
            sourceRunId: scope.sourceRunId,
            sourceRunAttempt: scope.sourceRunAttempt,
          },
        },
        { checkpoints: dependencies.reviewExecutionCheckpoints, now },
      );
    },
  );
}
