import { ArrowUpRight, GitFork } from "lucide-react";
import { Button } from "@reviewrouter/ui";
import type { StatisticsReport } from "@reviewrouter/features-review-statistics";
import { count } from "../application/statistics-presentation";
import styles from "./statistics.module.css";
type Row = StatisticsReport["topRepositoriesByReviews"][number];
export function StatisticsRanking({
  title,
  rows,
  onViewIssues,
}: {
  title: string;
  rows: readonly Row[];
  onViewIssues?: (repository: Row) => void;
}) {
  return (
    <section className={styles.ranking} aria-label={title}>
      <h3 className={styles.rankingTitle}>{title}</h3>
      {!rows.length ? (
        <p className={styles.help}>No recorded activity for this selection.</p>
      ) : (
        <ol className={styles.rankingList}>
          {rows.map((row) => (
            <li key={row.repositoryId} className={styles.rankingRow}>
              <span className={styles.repoName} title={row.fullName}>
                <GitFork size={14} aria-hidden="true" />
                <span>{row.fullName}</span>
              </span>
              {row.url ? (
                <a
                  className={styles.external}
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${row.fullName} repository`}
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              ) : null}
              <span className={styles.rankCount}>{count(row.count)}</span>
              {onViewIssues ? (
                <Button
                  className={styles.rankAction}
                  variant="ghost"
                  size="sm"
                  onClick={() => onViewIssues(row)}
                  aria-label={`View issues in ${row.fullName}`}
                >
                  Issues
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
