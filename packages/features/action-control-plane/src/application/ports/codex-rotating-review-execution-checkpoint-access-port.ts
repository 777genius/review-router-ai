export type CodexRotatingReviewExecutionCheckpointScope = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly sourceRunId: string;
  readonly sourceRunAttempt: string;
  readonly pullRequestNumber: number;
};

export interface CodexRotatingReviewExecutionCheckpointAccessPort {
  withAuthorizedReviewExecutionCheckpointAccess<T>(
    input: {
      readonly leaseId: string;
      readonly providerInstanceId: string;
      readonly pullRequestNumber: number;
      readonly now: Date;
    },
    effect: (scope: CodexRotatingReviewExecutionCheckpointScope) => Promise<T>,
  ): Promise<T>;
}
