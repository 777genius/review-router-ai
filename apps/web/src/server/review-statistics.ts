import { timeAnalyticsRead } from "./analytics-read-timing";
import {
  StatisticsAccessError,
  StatisticsValidationError,
  StatisticsSeverity,
  type StatisticsFilter,
} from "@reviewrouter/features-review-statistics";
import { createReviewStatisticsFeature } from "@reviewrouter/features-review-statistics/composition";
import { HistoryAccessError } from "@reviewrouter/features-review-history/contracts";
import { createReviewHistoryFeature } from "@reviewrouter/features-review-history/composition";
import type {
  StatisticsIssuesResponse,
  StatisticsIssueView,
} from "../features/review-statistics/application/statistics-model";
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
  const prisma = getPrisma();
  const feature = await createReviewStatisticsFeature({ prisma });
  return { actorId: actor.userId, reader: feature.reader, prisma };
}
export async function loadStatisticsReport(
  workspaceId: string,
  filter: StatisticsFilter = { days: 30, severity: "all" },
) {
  const { actorId, reader } = await context();
  return {
    actorId,
    report: await timeAnalyticsRead("statistics.report", () =>
      reader.readReport({ actorId, workspaceId, filter }),
    ),
  };
}
export async function loadStatisticsIssues(
  workspaceId: string,
  params: URLSearchParams,
): Promise<StatisticsIssuesResponse> {
  const { actorId, reader, prisma } = await context();
  const { severity } = readStatisticsFilter(params);
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) throw new StatisticsValidationError();
  const repositoryId = params.get("repositoryId");
  const cursor = params.get("cursor");
  const page = await reader.readIssues({
    actorId,
    workspaceId,
    from,
    to,
    severity,
    ...(repositoryId !== null ? { repositoryId } : {}),
    ...(cursor !== null ? { cursor } : {}),
  });
  const history = await createReviewHistoryFeature({ prisma });
  let resolution;
  try {
    resolution = await history.reader.resolvePullRequests({
      actorId,
      workspaceId,
      pullRequests: page.items.map((issue) => ({
        scmRepositoryIdentityId: issue.scmRepositoryIdentityId,
        pullRequestNumber: issue.pullRequestNumber,
      })),
    });
  } catch (error) {
    if (error instanceof HistoryAccessError) throw new StatisticsAccessError();
    throw error;
  }
  const targets = new Set(
    resolution.state === "available"
      ? resolution.items.map((item) =>
          JSON.stringify([
            item.scmRepositoryIdentityId,
            item.pullRequestNumber,
          ]),
        )
      : [],
  );
  const items: StatisticsIssueView[] = page.items.map((issue) => {
    const linked = targets.has(
      JSON.stringify([issue.scmRepositoryIdentityId, issue.pullRequestNumber]),
    );
    const params = new URLSearchParams({
      section: "reviews",
      workspace: workspaceId,
      reviewRepository: issue.scmRepositoryIdentityId,
      reviewSearch: String(issue.pullRequestNumber),
    });
    return {
      ...issue,
      history:
        resolution.state === "unavailable"
          ? { status: "temporarily_unavailable" }
          : linked
            ? {
                status: "linked",
                href: `/dashboard?${params}#dashboard-section-content`,
              }
            : { status: "not_recorded" },
    };
  });
  return {
    scope: { actorId, workspaceId },
    page: { items, nextCursor: page.nextCursor },
  };
}
