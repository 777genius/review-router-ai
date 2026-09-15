export type CodexRotatingReviewSnapshotScope = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly sourceRunId: string;
  readonly sourceRunAttempt: string;
  readonly pullRequestNumber: number;
};

export interface CodexRotatingReviewSnapshotAccessPort {
  withAuthorizedReviewSnapshotAccess<T>(
    input: {
      readonly leaseId: string;
      readonly providerInstanceId: string;
      readonly pullRequestNumber: number;
      readonly now: Date;
    },
    effect: (scope: CodexRotatingReviewSnapshotScope) => Promise<T>,
  ): Promise<T>;
}
