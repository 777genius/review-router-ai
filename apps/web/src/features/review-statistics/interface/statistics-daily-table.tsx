import type { StatisticsReport } from "@reviewrouter/features-review-statistics";
import {
  count,
  fullDayLabel,
  periodLabel,
  severities,
  severityLabels,
} from "../application/statistics-presentation";
import styles from "./statistics.module.css";
export function StatisticsDailyTable({ report }: { report: StatisticsReport }) {
  const today = report.period.to.slice(0, 10);
  return (
    <details className={styles.details}>
      <summary>Daily data · all severities</summary>
      <div
        className={styles.tableWrap}
        tabIndex={0}
        role="region"
        aria-label="Daily review data"
      >
        <table className={styles.table}>
          <caption>
            {periodLabel(report)}. Exact daily counts, all severities. A pull
            request may appear on several days; daily PR counts do not add up to
            the distinct period total.
          </caption>
          <thead>
            <tr>
              <th scope="col">UTC day</th>
              <th scope="col">Coverage</th>
              <th scope="col">PRs reviewed</th>
              <th scope="col">Reviews</th>
              {severities.map((value) => (
                <th scope="col" key={value}>
                  {severityLabels[value]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.daily.map((row) => (
              <tr key={row.day}>
                <th scope="row">
                  {fullDayLabel(row.day)}
                  {row.day === today ? " · in progress" : ""}
                </th>
                <td>
                  {row.coverage === "complete"
                    ? "Covered"
                    : row.coverage === "partial"
                      ? "Partial history or sources"
                      : "Unavailable"}
                </td>
                <td>
                  {row.coverage === "unavailable"
                    ? "Unavailable"
                    : count(row.pullRequestsReviewed)}
                </td>
                <td>
                  {row.coverage === "unavailable"
                    ? "Unavailable"
                    : count(row.reviews)}
                </td>
                {severities.map((severity) => (
                  <td key={severity}>
                    {row.coverage === "unavailable"
                      ? "Unavailable"
                      : count(row.issues[severity])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
