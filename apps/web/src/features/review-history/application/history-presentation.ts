import {
  HistoryStatus,
  type HistoryFilters,
} from "@reviewrouter/features-review-history/contracts";

export const defaultHistoryFilters: HistoryFilters = {
  q: "",
  repositoryId: null,
  status: "all",
  days: null,
};
export const historyStatusLabels: Record<HistoryStatus, string> = {
  [HistoryStatus.Queued]: "Queued",
  [HistoryStatus.Running]: "In progress",
  [HistoryStatus.Publishing]: "Publishing",
  [HistoryStatus.Completed]: "Completed",
  [HistoryStatus.Incomplete]: "Incomplete",
  [HistoryStatus.Failed]: "Failed",
  [HistoryStatus.Stopped]: "Stopped",
  [HistoryStatus.Unconfirmed]: "Result unconfirmed",
};
export function historyStatusTone(
  status: HistoryStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  if (status === HistoryStatus.Completed) return "success";
  if (status === HistoryStatus.Failed) return "danger";
  if ([HistoryStatus.Incomplete, HistoryStatus.Unconfirmed].includes(status))
    return "warning";
  return [HistoryStatus.Running, HistoryStatus.Publishing].includes(status)
    ? "accent"
    : "neutral";
}
const instantFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
export const historyInstant = (value: string) =>
  `${instantFormat.format(new Date(value))} UTC`;
export const historyDay = (value: string) => dayFormat.format(new Date(value));

export function historyFiltersFromUrl(
  params: Pick<URLSearchParams, "get">,
): HistoryFilters {
  const status = params.get("reviewStatus") ?? "all";
  const days = params.get("reviewDays") ?? "";
  return {
    q: params.get("reviewSearch") ?? "",
    repositoryId: params.get("reviewRepository") || null,
    status: status as HistoryFilters["status"],
    days: (days ? Number(days) : null) as HistoryFilters["days"],
  };
}
export function historyFilterProblem(filters: HistoryFilters): string | null {
  if (
    filters.q.length > 200 ||
    (filters.q.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) > 8
  )
    return "Try a shorter search.";
  if (
    !["all", "active", "completed", "attention"].includes(filters.status) ||
    ![null, 7, 30, 90].includes(filters.days)
  )
    return "Choose a status and period, or clear the filters.";
  return null;
}
export function historyFiltersUrl(filters: HistoryFilters): string {
  const url = new URL(window.location.href);
  for (const key of [
    "reviewSearch",
    "reviewRepository",
    "reviewStatus",
    "reviewDays",
  ])
    url.searchParams.delete(key);
  if (filters.q) url.searchParams.set("reviewSearch", filters.q);
  if (filters.repositoryId)
    url.searchParams.set("reviewRepository", filters.repositoryId);
  if (filters.status !== "all")
    url.searchParams.set("reviewStatus", filters.status);
  if (filters.days) url.searchParams.set("reviewDays", String(filters.days));
  return `${url.pathname}${url.search}${url.hash}`;
}
