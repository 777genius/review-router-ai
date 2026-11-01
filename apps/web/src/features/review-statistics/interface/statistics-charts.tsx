"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, SelectField } from "@reviewrouter/ui";
import {
  statisticsMetricCatalog,
  type StatisticsFilter,
  type StatisticsReport,
} from "@reviewrouter/features-review-statistics";
import {
  chartRows,
  count,
  dayLabel,
  fullDayLabel,
  severities,
  severityColors,
  severityLabels,
} from "../application/statistics-presentation";
import { StatisticsRanking } from "./statistics-ranking";
import styles from "./statistics.module.css";
import type { StatisticsActivityMetric } from "../application/statistics-url";
type Row = ReturnType<typeof chartRows>[number];
function DailyTooltip({
  active,
  payload,
  metric,
  severity,
  today,
}: {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  metric?: StatisticsActivityMetric;
  severity: StatisticsFilter["severity"];
  today: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const metricDefinition = metric
    ? statisticsMetricCatalog.find((item) => item.valueKey === metric)
    : undefined;
  return (
    <div className={styles.tooltip}>
      <strong>{fullDayLabel(row.day)} · UTC</strong>
      {row.day === today ? <div>Today · in progress</div> : null}
      {row.coverage === "unavailable" ? (
        <div>History unavailable</div>
      ) : (
        <>
          {metric ? (
            <div>
              {metricDefinition?.label}:{" "}
              {count(row[metric] ?? 0)}
            </div>
          ) : (
            (severity === "all" ? severities : [severity]).map((value) => (
              <div key={value}>
                {severityLabels[value]}: {count(row.issues[value])}
              </div>
            ))
          )}
          {row.coverage === "partial" ? (
            <div>Partial history or source coverage</div>
          ) : null}
        </>
      )}
    </div>
  );
}
function DailyChart({
  report,
  metric,
}: {
  report: StatisticsReport;
  metric?: StatisticsActivityMetric;
}) {
  const severity = report.filter.severity;
  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={chartRows(report)}
          accessibilityLayer
          aria-label={
            metric
              ? "Daily " +
                (metric === "reviews" ? "reviews" : "pull requests reviewed")
              : "Daily issues caught · " +
                (severity === "all"
                  ? "all severities"
                  : severityLabels[severity])
          }
          margin={{ top: 10, right: 12, bottom: 0, left: -14 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--rr-color-border)"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="day"
            tickFormatter={dayLabel}
            minTickGap={30}
            tick={{ fill: "var(--rr-color-text-subtle)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, (max: number) => Math.max(1, max)]}
            width={45}
            tick={{ fill: "var(--rr-color-text-subtle)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--rr-color-border)" }}
            content={
              <DailyTooltip
                {...(metric ? { metric } : {})}
                severity={severity}
                today={report.period.to.slice(0, 10)}
              />
            }
          />
          {metric ? (
            <Bar
              dataKey={metric}
              fill="var(--rr-chart-amber)"
              radius={[2, 2, 0, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          ) : (
            (severity === "all" ? severities : [severity]).map((value) => (
              <Bar
                key={value}
                dataKey={(row: Row) =>
                  row.coverage === "unavailable" ? null : row.issues[value]
                }
                name={severityLabels[value]}
                stackId="issues"
                fill={severityColors[value]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function StatisticsCharts({
  report,
  metric,
  onMetricChange,
  onViewIssues,
}: {
  report: StatisticsReport;
  metric: StatisticsActivityMetric;
  onMetricChange: (metric: StatisticsActivityMetric) => void;
  onViewIssues: (
    repository?: StatisticsReport["topRepositoriesByIssues"][number],
  ) => void;
}) {
  const metricDefinition = statisticsMetricCatalog.find(
    (item) => item.valueKey === metric,
  );
  return (
    <div className={styles.chartGrid}>
      <section className={styles.chartSection} aria-label="Review activity">
        <div className={styles.chartHeader}>
          <h2 className={styles.chartTitle}>Review activity</h2>
          <SelectField
            name="statistics-metric"
            label="Chart metric"
            value={metric}
            options={statisticsMetricCatalog
              .filter((item) => item.valueKey !== "issuesCaught")
              .map((item) => ({ value: item.valueKey, label: item.label }))}
            onValueChange={(value) =>
              onMetricChange(value as StatisticsActivityMetric)
            }
            className={styles.chartSelector ?? ""}
          />
        </div>
        <div className={styles.chartBody}>
          <DailyChart report={report} metric={metric} />
          <p className={styles.legend}>
            {metricDefinition?.description}{" "}
            · Daily UTC counts · today in progress
          </p>
        </div>
        <StatisticsRanking
          title="Top repositories by reviews"
          rows={report.topRepositoriesByReviews}
        />
      </section>
      <section className={styles.chartSection} aria-label="Issues caught">
        <div className={styles.chartHeader}>
          <h2 className={styles.chartTitle}>Issues caught</h2>
        </div>
        <div className={styles.chartBody}>
          <DailyChart report={report} />
          <ul className={styles.legend} aria-label="Severity legend">
            {severities.map((value) => (
              <li key={value}>
                <span
                  className={styles.dot}
                  style={{ background: severityColors[value] }}
                  aria-hidden="true"
                />
                {severityLabels[value]}
              </li>
            ))}
          </ul>
        </div>
        <StatisticsRanking
          title={
            report.filter.severity === "all"
              ? "Repositories with the most issues"
              : "Repositories with the most " +
                severityLabels[report.filter.severity].toLowerCase() +
                " issues"
          }
          rows={report.topRepositoriesByIssues}
          onViewIssues={onViewIssues}
        />
        <div className={styles.chartFooter}>
          <Button variant="ghost" size="sm" onClick={() => onViewIssues()}>
            View issues caught →
          </Button>
        </div>
      </section>
    </div>
  );
}
