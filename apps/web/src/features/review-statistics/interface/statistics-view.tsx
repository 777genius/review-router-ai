"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, SelectField } from "@reviewrouter/ui";
import { RefreshCw } from "lucide-react";
import type {
  StatisticsFilter,
  StatisticsReport,
} from "@reviewrouter/features-review-statistics";
import {
  fetchStatisticsReport,
  isStatisticsAccessFailure,
  statisticsReportKey,
  statisticsScopeKey,
} from "../adapters/statistics-api";
import {
  instantLabel,
  periodLabel,
} from "../application/statistics-presentation";
import { StatisticsSummary } from "./statistics-summary";
import { StatisticsCharts } from "./statistics-charts";
import { StatisticsDailyTable } from "./statistics-daily-table";
import { StatisticsIssues, type IssueRepository } from "./statistics-issues";
import styles from "./statistics.module.css";

type Props = {
  actorId: string;
  workspaceId: string;
  seedId: string;
  initialReport: StatisticsReport;
};
export function StatisticsView(props: Props) {
  return (
    <StatisticsInstance
      key={JSON.stringify([props.actorId, props.workspaceId, props.seedId])}
      {...props}
    />
  );
}
function StatisticsInstance({
  actorId,
  workspaceId,
  seedId,
  initialReport,
}: Props) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<StatisticsFilter>(initialReport.filter);
  const [metric, setMetric] = useState<"pullRequestsReviewed" | "reviews">(
    "pullRequestsReviewed",
  );
  const [denied, setDenied] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [repository, setRepository] = useState<IssueRepository | null>(null);
  const section = useRef<HTMLElement>(null);
  const restoreControlFocus = useRef<"severity" | "refresh" | null>(null);
  const refreshControl = useRef<HTMLButtonElement>(null);
  const [issueFocusRequest, setIssueFocusRequest] = useState(0);
  useEffect(() => {
    if (!issueFocusRequest) return;
    const target =
      section.current?.querySelector<HTMLElement>("#statistics-issues");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [issueFocusRequest]);
  const active = useRef(true);
  const deniedRef = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const rejectAccess = useCallback(() => {
    if (!active.current || deniedRef.current) return;
    deniedRef.current = true;
    setDenied(true);
    const prefix = statisticsScopeKey(actorId, workspaceId);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  }, [actorId, workspaceId, client]);
  const matchesSeed =
    filter.days === initialReport.filter.days &&
    filter.severity === initialReport.filter.severity;
  const query = useQuery({
    queryKey: statisticsReportKey(actorId, workspaceId, seedId, filter),
    queryFn: async ({ signal }) => {
      try {
        return await fetchStatisticsReport(workspaceId, filter, signal);
      } catch (error) {
        if (isStatisticsAccessFailure(error)) rejectAccess();
        throw error;
      }
    },
    enabled: !denied,
    initialData: !denied && matchesSeed ? initialReport : undefined,
    staleTime: 30_000,
    retry: (failures, error) =>
      !isStatisticsAccessFailure(error) && failures < 1,
  });
  const report =
    denied || isStatisticsAccessFailure(query.error) ? undefined : query.data;
  useEffect(() => {
    if (!report || query.isFetching || !restoreControlFocus.current) return;
    const control = restoreControlFocus.current;
    restoreControlFocus.current = null;
    // Loading removes Severity or disables Refresh. Restore their initiating
    // focus only when it fell away and the user has not moved to another control.
    if (document.activeElement && document.activeElement !== document.body)
      return;
    const target =
      control === "refresh"
        ? refreshControl.current
        : section.current
            ?.querySelector('[name="statistics-severity"]')
            ?.closest("label")
            ?.querySelector<HTMLElement>('[role="combobox"], select');
    target?.focus({ preventScroll: true });
  }, [report, query.isFetching]);
  const changeFilter = (changes: Partial<StatisticsFilter>) => {
    restoreControlFocus.current =
      changes.severity !== undefined ? "severity" : null;
    setRepository(null);
    setFilter((current) => ({ ...current, ...changes }));
  };
  const issueIdentity = report
    ? JSON.stringify([
        report.period.from,
        report.period.to,
        report.filter.severity,
        query.dataUpdatedAt,
        repository?.repositoryId,
      ])
    : "";
  return (
    <section
      ref={section}
      id="dashboard-section-content"
      className={styles.root}
      aria-label="Review statistics"
    >
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Statistics</h1>
          <p className={styles.subtitle}>
            Your workspace's review activity and the issues caught along the
            way.
          </p>
        </div>
        <div className={styles.controls}>
          <SelectField
            name="statistics-period"
            label="Period"
            value={String(filter.days)}
            disabled={denied}
            options={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ]}
            onValueChange={(value) =>
              changeFilter({ days: Number(value) as StatisticsFilter["days"] })
            }
            className={styles.periodControl ?? ""}
          />
          <Button
            ref={refreshControl}
            variant="outline"
            size="sm"
            disabled={denied || query.isFetching}
            aria-busy={query.isFetching}
            onClick={() => {
              restoreControlFocus.current = "refresh";
              void query.refetch();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{query.isFetching ? "Refreshing…" : "Refresh"}</span>
          </Button>
        </div>
      </header>
      {denied ? (
        <p role="alert" className={styles.status}>
          Statistics access is no longer available. Open an authorized workspace
          report to continue.
        </p>
      ) : !report ? (
        <div
          role={query.isError ? "alert" : "status"}
          className={styles.status}
        >
          {query.isError ? (
            <>Statistics could not be loaded. Use Refresh to try again.</>
          ) : (
            "Loading statistics…"
          )}
        </div>
      ) : (
        <>
          <div className={styles.period}>
            <span>{periodLabel(report)}</span>
            <span>
              Today in progress · updated {instantLabel(report.period.asOf)} UTC
            </span>
          </div>
          {query.isError ? (
            <p role="alert" className={styles.notice}>
              Refresh failed. Showing the last available report for this period.
              Use Refresh to try again.
            </p>
          ) : null}
          {report.coverage.availableSince === null ? (
            <p className={styles.status}>
              Statistics are not available yet for this workspace.
            </p>
          ) : (
            <>
              {!report.coverage.currentComplete ||
              !report.coverage.previousComplete ? (
                <div className={styles.notice}>
                  {!report.coverage.currentComplete ? (
                    <>
                      These are recorded activity counts; some history or
                      connected review sources are not covered.{" "}
                    </>
                  ) : (
                    <>Earlier history is not fully available. </>
                  )}
                  History available since{" "}
                  {instantLabel(report.coverage.availableSince)} UTC.
                  Comparisons appear when both periods are fully covered.
                  {report.coverage.uncoveredSources.length ? (
                    <div>
                      Some connected review sources are not included in these
                      counts.
                    </div>
                  ) : null}
                </div>
              ) : null}
              <StatisticsSummary report={report} />
              {report.totals.reviews === 0 ? (
                <p className={styles.empty}>
                  {report.coverage.currentComplete
                    ? "No published reviews in this period yet."
                    : "No recorded reviews in this period. Uncovered activity may be missing."}
                </p>
              ) : null}
              <StatisticsCharts
                report={report}
                metric={metric}
                onMetricChange={setMetric}
                onSeverityChange={(severity) => changeFilter({ severity })}
                onViewIssues={(row) => {
                  setRepository(
                    row
                      ? {
                          repositoryId: row.repositoryId,
                          fullName: row.fullName,
                        }
                      : null,
                  );
                  setIssuesOpen(true);
                  setIssueFocusRequest((request) => request + 1);
                }}
              />
              <p className={styles.help}>
                Issues caught includes all severities. An issue is counted when
                first recorded; findings are reported issues, not verified bugs.
                Daily PR counts can include the same pull request on more than
                one day.
              </p>
              <StatisticsDailyTable report={report} />
              {issuesOpen ? (
                <StatisticsIssues
                  key={issueIdentity}
                  actorId={actorId}
                  workspaceId={workspaceId}
                  seedId={seedId}
                  report={report}
                  repository={repository}
                  onResetRepository={() => {
                    setRepository(null);
                    setIssueFocusRequest((request) => request + 1);
                  }}
                  onClose={() => setIssuesOpen(false)}
                  onAccessFailure={rejectAccess}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
