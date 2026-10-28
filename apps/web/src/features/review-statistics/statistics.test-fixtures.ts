import {
  StatisticsDayCoverage,
  StatisticsSeverity,
  type StatisticsIssue,
  type StatisticsReport,
} from "@reviewrouter/features-review-statistics";
export const statisticsFixture = (): StatisticsReport => ({
  period: {
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-23T12:00:00.000Z",
    previousFrom: "2026-08-25T00:00:00.000Z",
    previousTo: "2026-09-23T12:00:00.000Z",
    days: 30,
    timezone: "UTC",
    asOf: "2026-10-23T12:00:00.000Z",
  },
  filter: { days: 30, severity: "all" },
  coverage: {
    availableSince: "2026-01-01T00:00:00.000Z",
    currentComplete: true,
    previousComplete: true,
    uncoveredSources: [],
  },
  totals: {
    pullRequestsReviewed: 1,
    reviews: 3,
    issuesCaught: 4,
    repositoriesWithIssues: 1,
  },
  previousTotals: {
    pullRequestsReviewed: 1,
    reviews: 2,
    issuesCaught: 1,
    repositoriesWithIssues: 1,
  },
  daily: Array.from({ length: 30 }, (_, index) => ({
    day: new Date(Date.UTC(2026, 8, 24 + index)).toISOString().slice(0, 10),
    coverage: StatisticsDayCoverage.Complete,
    pullRequestsReviewed: index === 0 || index === 29 ? 1 : 0,
    reviews: index === 0 ? 2 : index === 29 ? 1 : 0,
    issues: {
      critical: index === 0 ? 1 : 0,
      major: index === 0 ? 1 : 0,
      minor: index === 29 ? 1 : 0,
      unknown: index === 29 ? 1 : 0,
    },
  })),
  topRepositoriesByReviews: [
    {
      repositoryId: "repo-a",
      fullName: "acme/project",
      url: "https://github.com/acme/project",
      count: 3,
    },
  ],
  topRepositoriesByIssues: [
    {
      repositoryId: "repo-a",
      fullName: "acme/project",
      url: "https://github.com/acme/project",
      count: 4,
    },
  ],
});
export const issueFixture = (id = "issue-a"): StatisticsIssue => ({
  id,
  title: `Issue ${id}`,
  severity: StatisticsSeverity.Major,
  repositoryId: "repo-a",
  repositoryFullName: "acme/project",
  pullRequestNumber: 17,
  pullRequestUrl: "https://github.com/acme/project/pull/17",
  caughtAt: "2026-10-23T10:00:00.000Z",
});
