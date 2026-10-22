import { PrismaWorkspaceAccessRepository } from "@reviewrouter/features-auth";
import { PrismaUsageReportReader } from "@reviewrouter/features-provider-usage/composition";
import {
  validateReportQuery,
  type UsageReportQuery,
} from "@reviewrouter/features-provider-usage";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { getPrisma } from "./prisma";
import {
  buildUsageReport,
  type UsageFilters,
} from "./provider-usage-view-model";

export function usageReportQuery(
  workspaceId: string,
  actorId: string,
  access: "admin" | "member",
  filters: UsageFilters,
  now = new Date(),
): UsageReportQuery {
  const to = filters.to ? new Date(filters.to) : now;
  const from = filters.from
    ? new Date(filters.from)
    : new Date(to.getTime() - 30 * 86400000);
  if (filters.route && !["gateway", "direct"].includes(filters.route))
    throw new Error("usage_invalid_report_query");
  if (filters.purpose && !["review", "diagnostic"].includes(filters.purpose))
    throw new Error("usage_invalid_report_query");
  const query: UsageReportQuery = {
    workspaceId,
    actorId,
    access,
    from,
    to,
    limit: 100,
    ...(filters.route ? { route: filters.route } : {}),
    ...(filters.purpose ? { purpose: filters.purpose } : {}),
    ...(filters.bindingId ? { bindingId: filters.bindingId } : {}),
    ...(filters.runId ? { runId: filters.runId } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.after ? { after: filters.after } : {}),
  };
  validateReportQuery(query);
  return query;
}
export async function loadProviderUsage(
  workspaceId: string,
  filters: UsageFilters = {},
) {
  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor?.userId) throw new Error("usage_sign_in_required");
  const prisma = getPrisma();
  const [role, workspace] = await Promise.all([
    new PrismaWorkspaceAccessRepository(prisma).findWorkspaceRoleByUserId({
      workspaceId,
      userId: actor.userId,
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { deletionState: true, personalOwnerUserId: true },
    }),
  ]);
  if (
    (!role && workspace?.personalOwnerUserId !== actor.userId) ||
    !workspace ||
    workspace.deletionState !== "active"
  )
    throw new Error("usage_access_denied");
  const query = usageReportQuery(
    workspaceId,
    actor.userId,
    workspace.personalOwnerUserId === actor.userId ||
      role === "owner" ||
      role === "admin"
      ? "admin"
      : "member",
    filters,
  );
  const report = await new PrismaUsageReportReader(prisma).report(query);
  return buildUsageReport(report);
}
