import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import {
  loadStatisticsReport,
  statisticsErrorStatus,
} from "../../src/server/review-statistics";
import { StatisticsView } from "../../src/features/review-statistics/interface/statistics-view";
import { StatisticsRetry } from "../../src/features/review-statistics/interface/statistics-retry";
import styles from "../../src/features/review-statistics/interface/statistics.module.css";
export async function ReviewStatisticsSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  try {
    const { actorId, report } = await loadStatisticsReport(workspaceId);
    return (
      <StatisticsView
        actorId={actorId}
        workspaceId={workspaceId}
        seedId={randomUUID()}
        initialReport={report}
      />
    );
  } catch (error) {
    unstable_rethrow(error);
    const status = statisticsErrorStatus(error);
    if (status === 500) {
      // Infrastructure errors can contain credentials or SQL; log only scope.
      console.error("review_statistics_load_failed", { workspaceId });
    }
    return (
      <section
        id="dashboard-section-content"
        className={styles.root}
        aria-label="Review statistics"
      >
        <h1 className={styles.title}>Statistics</h1>
        <div className={styles.status} role="alert">
          {status === 401
            ? "Sign in to view workspace statistics."
            : status === 403
              ? "Statistics require ownership of a personal workspace or membership in this workspace. Repository access does not grant access to this report."
              : "Statistics could not be loaded."}
          {status !== 401 ? <StatisticsRetry /> : null}
        </div>
      </section>
    );
  }
}
