export type {
  ProviderUsageReport,
  UsageFilters,
  UsageReportRow,
} from "../../src/server/provider-usage-view-model";
import type { ProviderUsageReport } from "../../src/server/provider-usage-view-model";
export type ProviderUsageScope = {
  actorId: string;
  workspaceId: string;
  effectiveAccess: "admin" | "member";
};
export type ProviderUsageSeedScope = ProviderUsageScope & { seedId: string };
export type ProviderUsageResponse = {
  scope: ProviderUsageScope;
  report: ProviderUsageReport;
};
