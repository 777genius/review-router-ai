import {
  StatisticsSeverity,
  type StatisticsReport,
} from "@reviewrouter/features-review-statistics";

export const severities = [
  StatisticsSeverity.Critical,
  StatisticsSeverity.Major,
  StatisticsSeverity.Minor,
  StatisticsSeverity.Unknown,
] as const;
export const severityLabels: Record<StatisticsSeverity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  unknown: "Unknown",
};
export const severityColors: Record<StatisticsSeverity, string> = {
  critical: "var(--rr-chart-pink)",
  major: "var(--rr-chart-amber)",
  minor: "var(--rr-chart-cyan)",
  unknown: "var(--rr-chart-neutral)",
};
export const count = (value: number) => value.toLocaleString("en-US");
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(day));
export const fullDayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(day));
export const instantLabel = (instant: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
export function periodLabel(report: StatisticsReport): string {
  return `${fullDayLabel(report.period.from)} – ${fullDayLabel(report.period.to)} · UTC`;
}
export function changeLabel(current: number, previous: number): string {
  const difference = current - previous;
  if (difference === 0) return "No change";
  if (previous === 0) return `+${count(difference)} · new activity`;
  const percent = Math.abs((difference / previous) * 100);
  return `${difference > 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(percent)}%`;
}
export function chartRows(report: StatisticsReport) {
  return report.daily.map((row) => ({
    ...row,
    pullRequestsReviewed:
      row.coverage === "unavailable" ? null : row.pullRequestsReviewed,
    reviews: row.coverage === "unavailable" ? null : row.reviews,
    ...Object.fromEntries(
      severities.map((severity) => [
        severity,
        row.coverage === "unavailable" ? null : row.issues[severity],
      ]),
    ),
  }));
}
