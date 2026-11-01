import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import {
  loadStatisticsReport,
  statisticsErrorStatus,
} from "../../src/server/review-statistics";
import { StatisticsView } from "../../src/features/review-statistics/interface/statistics-view";
import {
  StatisticsInvalidFilters,
  StatisticsFilterRecovery,
} from "../../src/features/review-statistics/interface/statistics-filter-controls";
import {
  statisticsFilterFromUrl,
  statisticsSearchParams,
} from "../../src/features/review-statistics/application/statistics-url";
import { StatisticsRetry } from "../../src/features/review-statistics/interface/statistics-retry";
import styles from "../../src/features/review-statistics/interface/statistics.module.css";
export async function ReviewStatisticsSection({
  workspaceId,
  params = {},
}: {
  workspaceId: string;
  params?: Record<string, string | string[] | undefined>;
}) {
  const filter = statisticsFilterFromUrl(statisticsSearchParams(params));
  if (!filter)
    return (
      <section
        id="dashboard-section-content"
        className={styles.root}
        aria-label="Review statistics"
      >
        <h1 className={styles.title}>Statistics</h1>
        <StatisticsInvalidFilters />
      </section>
    );
  try {
    const { actorId, report } = await loadStatisticsReport(workspaceId, filter);
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
        {status !== 401 && status !== 403 ? (
          <StatisticsFilterRecovery filter={filter} />
        ) : null}
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
