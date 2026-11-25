import type { UsageReportQuery } from "./ports";
import type { UsagePeriodReport } from "./report-usage";
/** Scope is resolved by the server; browser workspace selections confer no authority. */
export interface UsageOperatorReportQuery extends Omit<
  UsageReportQuery,
  "workspaceId" | "actorId" | "access"
> {
  operatorWorkspaceId: string;
  actorId: string;
}
export interface UsageOperatorReportReader {
  report(query: UsageOperatorReportQuery): Promise<UsagePeriodReport>;
}
