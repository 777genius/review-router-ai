import type { StatisticsFilter } from "@reviewrouter/features-review-statistics";

export const defaultStatisticsFilter: StatisticsFilter = {
  days: 30,
  severity: "all",
};
const daysKey = "statisticsDays",
  severityKey = "statisticsSeverity";
export function statisticsFilterFromUrl(
  params: Pick<URLSearchParams, "getAll">,
): StatisticsFilter | null {
  const days = params.getAll(daysKey),
    severity = params.getAll(severityKey);
  if (days.length > 1 || severity.length > 1) return null;
  const day = days[0] ?? "30",
    level = severity[0] ?? "all";
  if (
    !["7", "30", "90"].includes(day) ||
    !["all", "critical", "major", "minor", "unknown"].includes(level)
  )
    return null;
  return {
    days: Number(day) as StatisticsFilter["days"],
    severity: level as StatisticsFilter["severity"],
  };
}
export function statisticsFilterUrl(
  href: string,
  filter: StatisticsFilter,
): string {
  const url = new URL(href);
  url.searchParams.delete(daysKey);
  url.searchParams.delete(severityKey);
  if (filter.days !== 30) url.searchParams.set(daysKey, String(filter.days));
  if (filter.severity !== "all")
    url.searchParams.set(severityKey, filter.severity);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function statisticsSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, values] of Object.entries(params))
    for (const value of Array.isArray(values)
      ? values
      : values === undefined
        ? []
        : [values])
      result.append(key, value);
  return result;
}
