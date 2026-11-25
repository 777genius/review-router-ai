import type {
  StatisticsIssue,
  StatisticsReport,
} from "@reviewrouter/features-review-statistics";

export type StatisticsScope = { actorId: string; workspaceId: string };
export type StatisticsIssueView = StatisticsIssue & {
  history:
    | { status: "linked"; href: string }
    | { status: "not_recorded" | "temporarily_unavailable" };
};
export type StatisticsIssueViewPage = {
  items: readonly StatisticsIssueView[];
  nextCursor: string | null;
};
export type StatisticsReportResponse = {
  scope: StatisticsScope;
  report: StatisticsReport;
};
export type StatisticsIssuesResponse = {
  scope: StatisticsScope;
  page: StatisticsIssueViewPage;
};
