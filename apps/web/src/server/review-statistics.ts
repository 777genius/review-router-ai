import {
  StatisticsAccessError,
  StatisticsValidationError,
  StatisticsSeverity,
  type StatisticsFilter,
} from "@reviewrouter/features-review-statistics";
import { createReviewStatisticsFeature } from "@reviewrouter/features-review-statistics/composition";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { getPrisma } from "./prisma";

export class StatisticsSignInRequiredError extends Error {
  constructor() {
    super("statistics_sign_in_required");
  }
}
export function statisticsErrorStatus(error: unknown): number {
  if (error instanceof StatisticsSignInRequiredError) return 401;
  if (error instanceof StatisticsAccessError) return 403;
  if (error instanceof StatisticsValidationError) return 400;
  return 500;
}
export function readStatisticsFilter(
  params: URLSearchParams,
): StatisticsFilter {
  const days = params.get("days") ?? "30";
  const severity = params.get("severity") ?? "all";
  if (
    !["7", "30", "90"].includes(days) ||
    (severity !== "all" &&
      !Object.values(StatisticsSeverity).includes(
        severity as StatisticsSeverity,
      ))
  ) {
    throw new StatisticsValidationError();
  }
  return {
    days: Number(days) as StatisticsFilter["days"],
    severity: severity as StatisticsFilter["severity"],
  };
}
async function context() {
  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor?.userId) throw new StatisticsSignInRequiredError();
  const feature = await createReviewStatisticsFeature({ prisma: getPrisma() });
  return { actorId: actor.userId, reader: feature.reader };
}
export async function loadStatisticsReport(
  workspaceId: string,
  filter: StatisticsFilter = { days: 30, severity: "all" },
) {
  const { actorId, reader } = await context();
  return {
    actorId,
    report: await reader.readReport({ actorId, workspaceId, filter }),
  };
}
export async function loadStatisticsIssues(
  workspaceId: string,
  params: URLSearchParams,
) {
  const { actorId, reader } = await context();
  const { severity } = readStatisticsFilter(params);
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) throw new StatisticsValidationError();
  const repositoryId = params.get("repositoryId");
  const cursor = params.get("cursor");
  return reader.readIssues({
    actorId,
    workspaceId,
    from,
    to,
    severity,
    ...(repositoryId !== null ? { repositoryId } : {}),
    ...(cursor !== null ? { cursor } : {}),
  });
}
