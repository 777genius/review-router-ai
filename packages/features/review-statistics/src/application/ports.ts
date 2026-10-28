import type {
  ReviewStatisticsSettledEvent,
  StatisticsIssuePage,
  StatisticsIssuesInput,
  StatisticsReport,
  StatisticsReportInput,
} from "../domain/statistics";
export interface ReviewStatisticsReader {
  readReport(input: StatisticsReportInput): Promise<StatisticsReport>;
  readIssues(input: StatisticsIssuesInput): Promise<StatisticsIssuePage>;
}
export enum ReviewStatisticsProjectionStatus {
  Applied = "applied",
  Duplicate = "duplicate",
  DeletedRepository = "deleted_repository",
}
export interface ReviewStatisticsProjector {
  project(
    event: ReviewStatisticsSettledEvent,
  ): Promise<ReviewStatisticsProjectionStatus>;
}
