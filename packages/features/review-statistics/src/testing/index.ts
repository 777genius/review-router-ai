import {
  ReviewStatisticsSettlementState,
  StatisticsSeverity,
  type ReviewStatisticsSettledEvent,
} from "../domain/statistics";

/** Deterministic portable settlement for consumer contract tests. No I/O. */
export function reviewStatisticsEventFixture(
  overrides: Partial<ReviewStatisticsSettledEvent> = {},
): ReviewStatisticsSettledEvent {
  return {
    version: 1,
    executionId: "statistics-test-execution",
    workspaceId: "statistics-test-workspace",
    repositoryConnectionId: "statistics-test-repository",
    scmRepositoryIdentityId: "statistics-test-scm-identity",
    pullRequestNumber: 1,
    finalizedArtifactId: "statistics-test-artifact",
    publicationAttemptId: "statistics-test-publication",
    projectionHash: "a".repeat(64),
    state: ReviewStatisticsSettlementState.Completed,
    settledAt: "2026-10-23T12:00:00.000Z",
    issues: [
      {
        lineageId: "statistics-test-lineage",
        severity: StatisticsSeverity.Major,
        title: "Example issue",
      },
    ],
    ...overrides,
  };
}
