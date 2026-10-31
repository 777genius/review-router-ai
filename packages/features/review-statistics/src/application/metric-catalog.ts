import type { StatisticsTotals } from "../domain/statistics";

/** Metadata about already-computed facts, never an alternative counting policy. */
export type StatisticsMetricDefinition = {
  readonly id: string;
  readonly version: 1;
  readonly label: string;
  readonly description: string;
  readonly valueKey: "reviews" | "pullRequestsReviewed" | "issuesCaught";
  readonly unit: "reviews" | "pull_requests" | "issues";
  readonly grain: "published_execution" | "repository_pull_request" | "issue_lineage";
  readonly aggregation: "count" | "distinct" | "first_occurrence";
  readonly dimensions: readonly ("day" | "top_repositories" | "severity")[];
  readonly coverage: "published_review_capture";
};

/**
 * Only dimensions present in existing report DTOs are advertised.
 * `top_repositories` is a ranking of five entries, never a complete grouping.
 */
export const statisticsMetricCatalog = [
  {
    id: "reviews.published",
    version: 1,
    label: "Published reviews",
    description: "Successful published executions; real reruns count, event replays do not.",
    valueKey: "reviews",
    unit: "reviews",
    grain: "published_execution",
    aggregation: "count",
    dimensions: ["day", "top_repositories"],
    coverage: "published_review_capture",
  },
  {
    id: "reviews.unique_prs",
    version: 1,
    label: "Pull requests reviewed",
    description: "Distinct SCM repository and pull request within the selected period; daily counts are not additive.",
    valueKey: "pullRequestsReviewed",
    unit: "pull_requests",
    grain: "repository_pull_request",
    aggregation: "distinct",
    dimensions: ["day"],
    coverage: "published_review_capture",
  },
  {
    id: "issues.first_seen",
    version: 1,
    label: "Issues caught",
    description: "Distinct first-recorded issue lineages; findings are not independently verified bugs.",
    valueKey: "issuesCaught",
    unit: "issues",
    grain: "issue_lineage",
    aggregation: "first_occurrence",
    dimensions: ["day", "severity", "top_repositories"],
    coverage: "published_review_capture",
  },
] as const satisfies readonly StatisticsMetricDefinition[];

export type StatisticsMetricId = (typeof statisticsMetricCatalog)[number]["id"];
/** Type-check that every selectable total exists in the owning report. */
export const statisticsTotalForMetric = (
  totals: StatisticsTotals,
  metric: (typeof statisticsMetricCatalog)[number],
): number => totals[metric.valueKey];
