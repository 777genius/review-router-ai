export enum StatisticsSeverity {
  Critical = "critical",
  Major = "major",
  Minor = "minor",
  Unknown = "unknown",
}
export enum StatisticsDayCoverage {
  Complete = "complete",
  Partial = "partial",
  Unavailable = "unavailable",
}
export enum StatisticsUncoveredSource {
  GitlabDirect = "gitlab_direct",
  HostedCertifiedFork = "hosted_certified_fork",
  UnqualifiedRepository = "unqualified_repository",
}
export type StatisticsFilter = {
  readonly days: 7 | 30 | 90;
  readonly severity: StatisticsSeverity | "all";
};
export type StatisticsTotals = {
  readonly pullRequestsReviewed: number;
  readonly reviews: number;
  readonly issuesCaught: number;
  readonly repositoriesWithIssues: number;
};
export type StatisticsRepositoryCount = {
  readonly repositoryId: string;
  readonly fullName: string;
  readonly url: string | null;
  readonly count: number;
};
export type StatisticsReport = {
  readonly period: {
    readonly from: string;
    readonly to: string;
    readonly previousFrom: string;
    readonly previousTo: string;
    readonly days: 7 | 30 | 90;
    readonly timezone: "UTC";
    readonly asOf: string;
  };
  readonly filter: StatisticsFilter;
  readonly coverage: {
    readonly availableSince: string | null;
    readonly currentComplete: boolean;
    readonly previousComplete: boolean;
    readonly uncoveredSources: readonly StatisticsUncoveredSource[];
  };
  readonly totals: StatisticsTotals;
  readonly previousTotals: StatisticsTotals | null;
  readonly daily: readonly {
    readonly day: string;
    readonly coverage: StatisticsDayCoverage;
    readonly pullRequestsReviewed: number;
    readonly reviews: number;
    readonly issues: Readonly<Record<StatisticsSeverity, number>>;
  }[];
  readonly topRepositoriesByReviews: readonly StatisticsRepositoryCount[];
  readonly topRepositoriesByIssues: readonly StatisticsRepositoryCount[];
};
export type StatisticsIssue = {
  readonly id: string;
  readonly title: string;
  readonly severity: StatisticsSeverity;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly scmRepositoryIdentityId: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string | null;
  readonly caughtAt: string;
};
export type StatisticsIssuePage = {
  readonly items: readonly StatisticsIssue[];
  readonly nextCursor: string | null;
};
export class StatisticsAccessError extends Error {
  readonly code = "statistics_access_denied";
  constructor() {
    super("statistics_access_denied");
    this.name = "StatisticsAccessError";
  }
}
export class StatisticsValidationError extends Error {
  readonly code = "statistics_invalid_query";
  constructor(message = "statistics_invalid_query") {
    super(message);
    this.name = "StatisticsValidationError";
  }
}
export class StatisticsCollisionError extends Error {
  readonly code = "statistics_execution_collision";
  constructor() {
    super("statistics_execution_collision");
    this.name = "StatisticsCollisionError";
  }
}
export const reviewStatisticsSettledEventType = "review.statistics.settled";
export const reviewStatisticsSettledEventVersion = 1;
export enum ReviewStatisticsSettlementState {
  Completed = "completed",
  CompletedSuperseded = "completed_superseded",
}
/** Compact immutable event independent of execution/artifact retention. */
export type ReviewStatisticsSettledEvent = {
  readonly version: 1;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly repositoryConnectionId: string;
  readonly scmRepositoryIdentityId: string;
  readonly pullRequestNumber: number;
  readonly finalizedArtifactId: string;
  readonly projectionHash: string;
  readonly publicationAttemptId: string;
  readonly state: ReviewStatisticsSettlementState;
  readonly settledAt: string;
  readonly issues: readonly {
    readonly lineageId: string;
    readonly severity: StatisticsSeverity;
    readonly title: string;
  }[];
};
export type StatisticsReportInput = {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly filter: StatisticsFilter;
};
export type StatisticsIssuesInput = {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly from: string;
  readonly to: string;
  readonly severity: StatisticsSeverity | "all";
  readonly repositoryId?: string;
  readonly cursor?: string;
};
