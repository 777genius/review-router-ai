import type {
  StatisticsFilter,
  StatisticsIssuePage,
  StatisticsReport,
} from "@reviewrouter/features-review-statistics";

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
  error instanceof StatisticsRequestError && [401, 403].includes(error.status);

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
): Promise<StatisticsReport> {
  return read(
    "/api/dashboard/review-statistics",
    new URLSearchParams({
      workspaceId,
      days: String(filter.days),
      severity: filter.severity,
    }),
    signal,
  );
}
export function fetchStatisticsIssues(
  workspaceId: string,
  filter: IssueFilters,
  signal: AbortSignal,
): Promise<StatisticsIssuePage> {
  const params = new URLSearchParams({ workspaceId });
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, value);
  }
  return read("/api/dashboard/review-statistics/issues", params, signal);
}
