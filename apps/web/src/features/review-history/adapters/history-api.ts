import type {
  HistoryFilters,
  HistoryPullRequestPage,
  HistoryRepositoryPage,
  HistoryRunPage,
} from "@reviewrouter/features-review-history/contracts";

export const historyScopeKey = (actorId: string, workspaceId: string) =>
  ["review-history", actorId, workspaceId] as const;
// A boolean trust tombstone, separate from private data removed after denial.
export const historyDeniedSeedKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
) => ["review-history-denied-seed", actorId, workspaceId, seedId] as const;
export const historyHadDenialKey = (actorId: string, workspaceId: string) =>
  ["review-history-had-denial", actorId, workspaceId] as const;
export const historySeedKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
) => [...historyScopeKey(actorId, workspaceId), seedId] as const;
export const historyListKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
  filters: HistoryFilters,
  cursor: string | null,
  refresh: number,
) =>
  [
    ...historySeedKey(actorId, workspaceId, seedId),
    "list",
    filters,
    cursor,
    refresh,
  ] as const;
export const historyRunsKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
  pullRequestId: string,
  refresh: number,
) =>
  [
    ...historySeedKey(actorId, workspaceId, seedId),
    "runs",
    pullRequestId,
    refresh,
  ] as const;
export const historyRepositoriesKey = (
  actorId: string,
  workspaceId: string,
  seedId: string,
  q: string,
  selectedRepositoryId: string | null,
) =>
  [
    ...historySeedKey(actorId, workspaceId, seedId),
    "repositories",
    q,
    selectedRepositoryId,
  ] as const;
export class HistoryRequestError extends Error {
  constructor(readonly status: number) {
    super("Review history is unavailable");
    this.name = "HistoryRequestError";
  }
}
export const isHistoryAccessFailure = (error: unknown): boolean =>
  error instanceof HistoryRequestError && [401, 403].includes(error.status);
async function read<T>(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(`${path}?${params}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new HistoryRequestError(response.status);
  return response.json() as Promise<T>;
}
export function fetchHistoryList(
  workspaceId: string,
  filters: HistoryFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<HistoryPullRequestPage> {
  const params = new URLSearchParams({
    workspaceId,
    q: filters.q,
    status: filters.status,
  });
  if (filters.repositoryId) params.set("repositoryId", filters.repositoryId);
  if (filters.days) params.set("days", String(filters.days));
  if (cursor) params.set("cursor", cursor);
  return read("/api/dashboard/review-history", params, signal);
}
export function fetchHistoryRuns(
  workspaceId: string,
  pullRequestId: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<HistoryRunPage> {
  const params = new URLSearchParams({ workspaceId, pullRequestId });
  if (cursor) params.set("cursor", cursor);
  return read("/api/dashboard/review-history/runs", params, signal);
}
export function fetchHistoryRepositories(
  workspaceId: string,
  q: string,
  selectedRepositoryId: string | null,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<HistoryRepositoryPage> {
  const params = new URLSearchParams({ workspaceId, q });
  if (selectedRepositoryId)
    params.set("selectedRepositoryId", selectedRepositoryId);
  if (cursor) params.set("cursor", cursor);
  return read("/api/dashboard/review-history/repositories", params, signal);
}
