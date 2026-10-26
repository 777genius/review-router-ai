"use client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
import { useState } from "react";
import type { StatisticsReport } from "@reviewrouter/features-review-statistics";
import {
  fetchStatisticsIssues,
  isStatisticsAccessFailure,
  statisticsIssuesKey,
  type IssueFilters,
} from "../adapters/statistics-api";
import {
  fullDayLabel,
  severityColors,
  severityLabels,
} from "../application/statistics-presentation";
import styles from "./statistics.module.css";

export type IssueRepository = { repositoryId: string; fullName: string };
export function StatisticsIssues({
  actorId,
  workspaceId,
  seedId,
  report,
  repository,
  onResetRepository,
  onClose,
  onAccessFailure,
}: {
  actorId: string;
  workspaceId: string;
  seedId: string;
  report: StatisticsReport;
  repository: IssueRepository | null;
  onResetRepository: () => void;
  onClose: () => void;
  onAccessFailure: () => void;
}) {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const filters: IssueFilters = {
    from: report.period.from,
    to: report.period.to,
    severity: report.filter.severity,
    ...(repository ? { repositoryId: repository.repositoryId } : {}),
    ...(cursor ? { cursor } : {}),
  };
  const query = useQuery({
    queryKey: statisticsIssuesKey(actorId, workspaceId, seedId, filters),
    queryFn: async ({ signal }) => {
      try {
        return await fetchStatisticsIssues(workspaceId, filters, signal);
      } catch (error) {
        if (isStatisticsAccessFailure(error)) onAccessFailure();
        throw error;
      }
    },
    staleTime: 30_000,
    retry: (failures, error) =>
      !isStatisticsAccessFailure(error) && failures < 1,
  });
  return (
    <section
      tabIndex={-1}
      className={styles.issues}
      aria-label="Recorded issues"
      id="statistics-issues"
    >
      <header className={styles.issueHeader}>
        <h2>Issues caught</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close issues
        </Button>
      </header>
      <div className={styles.issueScope}>
        <span>
          {report.filter.severity === "all"
            ? "All severities"
            : severityLabels[report.filter.severity]}
        </span>
        <span>·</span>
        <span>{repository?.fullName ?? "All repositories"}</span>
        {repository ? (
          <Button variant="ghost" size="sm" onClick={onResetRepository}>
            All repositories
          </Button>
        ) : null}
      </div>
      {!query.data ? (
        <div
          className={styles.status}
          role={query.isError ? "alert" : "status"}
        >
          {query.isError ? (
            <>
              Issues could not be loaded.
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Retry issues
              </Button>
            </>
          ) : (
            "Loading issues…"
          )}
        </div>
      ) : (
        <>
          {query.isError ? (
            <p role="alert" className={styles.notice}>
              Issue refresh failed. Showing this page's last available data.{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Retry issues
              </Button>
            </p>
          ) : null}
          {!query.data.items.length ? (
            <p className={styles.empty}>
              No recorded issues match this selection.
            </p>
          ) : (
            <ul className={styles.issueRows}>
              {query.data.items.map((issue) => (
                <li key={issue.id} className={styles.issueRow}>
                  <span className={styles.severity}>
                    <span
                      className={styles.dot}
                      style={{ background: severityColors[issue.severity] }}
                      aria-hidden="true"
                    />
                    {severityLabels[issue.severity]}
                  </span>
                  <div>
                    <div className={styles.issueTitle}>{issue.title}</div>
                    <div className={styles.issueMeta}>
                      <span>{issue.repositoryFullName}</span>
                      {issue.pullRequestUrl ? (
                        <a
                          href={issue.pullRequestUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.issueLink}
                        >
                          PR #{issue.pullRequestNumber} ↗
                        </a>
                      ) : (
                        <span>PR #{issue.pullRequestNumber}</span>
                      )}
                    </div>
                  </div>
                  <time
                    className={styles.issueDate}
                    dateTime={issue.caughtAt}
                    title="First recorded in UTC"
                  >
                    {fullDayLabel(issue.caughtAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.pagination} aria-label="Issue pages">
            <Button
              variant="outline"
              size="sm"
              disabled={!cursors.length || query.isFetching}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              Previous
            </Button>
            <span aria-live="polite">Page {cursors.length + 1}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data.nextCursor || query.isFetching}
              onClick={() => {
                const next = query.data?.nextCursor;
                if (next) setCursors((current) => [...current, next]);
              }}
            >
              Next
            </Button>
          </nav>
        </>
      )}
      <p className={styles.help}>
        First recorded dates are UTC. Findings are reported issues, not verified
        bugs.
      </p>
    </section>
  );
}
