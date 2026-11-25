import {
  StatisticsSeverity,
  ReviewStatisticsSettlementState,
  type ReviewStatisticsSettledEvent,
} from "../domain/statistics";
export function event(
  overrides: Partial<ReviewStatisticsSettledEvent> = {},
): ReviewStatisticsSettledEvent {
  return {
    version: 1,
    executionId: "execution-1",
    workspaceId: "work",
    repositoryConnectionId: "repo",
    scmRepositoryIdentityId: "scm",
    pullRequestNumber: 42,
    finalizedArtifactId: "artifact-1",
    projectionHash: "a".repeat(64),
    publicationAttemptId: "publication-1",
    state: ReviewStatisticsSettlementState.Completed,
    settledAt: "2026-10-23T11:00:00.000Z",
    issues: [
      {
        lineageId: "lineage",
        severity: StatisticsSeverity.Major,
        title: "Issue",
      },
    ],
    ...overrides,
  };
}
