import type { StatisticsReport } from "@reviewrouter/features-review-statistics";
import { changeLabel, count } from "../application/statistics-presentation";
import styles from "./statistics.module.css";
export function StatisticsSummary({ report }: { report: StatisticsReport }) {
  const compare =
    report.coverage.currentComplete &&
    report.coverage.previousComplete &&
    report.previousTotals;
  return (
    <dl className={styles.metrics} aria-label="All-severity review summary">
      {(
        [
          ["pullRequestsReviewed", "Pull requests reviewed"],
          ["reviews", "Total reviews"],
          ["issuesCaught", "Issues caught"],
        ] as const
      ).map(([key, label]) => (
        <div className={styles.metric} key={key}>
          <dt>{label}</dt>
          <dd>{count(report.totals[key])}</dd>
          <div className={styles.comparison}>
            {compare ? (
              <>
                <span className={styles.delta}>
                  {changeLabel(report.totals[key], compare[key])}
                </span>{" "}
                vs prior period
              </>
            ) : (
              "Recorded in this period"
            )}
            {key === "issuesCaught" ? (
              <>
                <br />
                All severities · {count(
                  report.totals.repositoriesWithIssues,
                )}{" "}
                {report.totals.repositoriesWithIssues === 1
                  ? "repository"
                  : "repositories"}
              </>
            ) : null}
          </div>
        </div>
      ))}
    </dl>
  );
}
