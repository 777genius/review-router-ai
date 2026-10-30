import type {
  StatisticsFilter,
  StatisticsReport,
} from "@reviewrouter/features-review-statistics";
import type {
  StatisticsScope,
  StatisticsReportResponse,
  StatisticsIssuesResponse,
  StatisticsIssueViewPage,
} from "../application/statistics-model";

export const statisticsScopeKey = (actorId: string, workspaceId: string) =>
  ["review-statistics", actorId, workspaceId] as const;
export const statisticsReportKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
  filter: StatisticsFilter,
) =>
  [
    ...statisticsScopeKey(actorId, workspaceId),
    seedId,
    "report",
    filter,
  ] as const;
export type IssueFilters = {
  from: string;
  to: string;
  severity: StatisticsFilter["severity"];
  repositoryId?: string;
  cursor?: string;
};
export const statisticsIssuesKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
  filter: IssueFilters,
) =>
  [
    ...statisticsScopeKey(actorId, workspaceId),
    seedId,
    "issues",
    filter,
  ] as const;

export class StatisticsRequestError extends Error {
  constructor(readonly status: number) {
    super("Statistics are unavailable");
    this.name = "StatisticsRequestError";
  }
}
export const isStatisticsAccessFailure = (error: unknown): boolean =>
  error instanceof StatisticsRequestError &&
  [401, 403, 409].includes(error.status);
export const isStatisticsScopeMismatch = (error: unknown): boolean =>
  error instanceof StatisticsRequestError && error.status === 409;

function checkScope(
  actual: StatisticsScope | undefined,
  expected: StatisticsScope,
): void {
  if (
    !actual ||
    actual.actorId !== expected.actorId ||
    actual.workspaceId !== expected.workspaceId
  )
    throw new StatisticsRequestError(409);
}

async function read<T>(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(`${path}?${params}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new StatisticsRequestError(response.status);
  return response.json() as Promise<T>;
}
export function fetchStatisticsReport(
  workspaceId: string,
  filter: StatisticsFilter,
  signal: AbortSignal,
  actorId: string,
): Promise<StatisticsReport> {
  return read<StatisticsReportResponse>(
    "/api/dashboard/review-statistics",
    new URLSearchParams({
      workspaceId,
      days: String(filter.days),
      severity: filter.severity,
    }),
    signal,
  ).then((response) => {
    checkScope(response?.scope, { actorId, workspaceId });
    return response.report;
  });
}
export function fetchStatisticsIssues(
  workspaceId: string,
  filter: IssueFilters,
  signal: AbortSignal,
  actorId: string,
): Promise<StatisticsIssueViewPage> {
  const params = new URLSearchParams({ workspaceId });
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, value);
  }
  return read<StatisticsIssuesResponse>(
    "/api/dashboard/review-statistics/issues",
    params,
    signal,
  ).then((response) => {
    checkScope(response?.scope, { actorId, workspaceId });
    return response.page;
  });
}
