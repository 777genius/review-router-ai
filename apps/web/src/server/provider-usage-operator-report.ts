import { PrismaOperatorUsageReportReader } from "@reviewrouter/features-provider-usage/composition";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { getPrisma } from "./prisma";
import { usageReportQuery } from "./provider-usage-report";
import {
  buildUsageReport,
  type UsageFilters,
} from "./provider-usage-view-model";

export async function loadOperatorProviderUsage(filters: UsageFilters = {}) {
  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor?.userId) throw new Error("usage_sign_in_required");
  // Same configured operator workspace and owner/admin membership as account grants.
  const operatorWorkspaceId = process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID;
  if (!operatorWorkspaceId) throw new Error("usage_access_denied");
  const period = usageReportQuery(
    operatorWorkspaceId,
    actor.userId,
    "admin",
    filters,
  );
  const report = await new PrismaOperatorUsageReportReader(
    getPrisma(),
    operatorWorkspaceId,
  ).report({ ...period, actorId: actor.userId, operatorWorkspaceId });
  return buildUsageReport(report);
}
