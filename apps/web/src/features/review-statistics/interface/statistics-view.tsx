"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePrivateQueryScope } from "../../../private-query-scope";
import {
  statisticsFilterFromUrl,
  statisticsActivityMetricFromUrl,
  statisticsActivityMetricUrl,
  defaultStatisticsActivityMetric,
  type StatisticsActivityMetric,
  statisticsFilterUrl,
} from "../application/statistics-url";
import { Button } from "@reviewrouter/ui";
import { RefreshCw } from "lucide-react";
import type {
  StatisticsFilter,
  StatisticsReport,
} from "@reviewrouter/features-review-statistics";
import {
  fetchStatisticsReport,
  isStatisticsAccessFailure,
  statisticsReportKey,
  isStatisticsScopeMismatch,
} from "../adapters/statistics-api";
import {
  instantLabel,
  periodLabel,
} from "../application/statistics-presentation";
import {
  StatisticsFilterControls,
  StatisticsInvalidFilters,
} from "./statistics-filter-controls";
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
  initialMetric?: StatisticsActivityMetric;
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
  initialMetric,
}: Props) {
  const router = useRouter();
  const scope = usePrivateQueryScope(
    { namespace: "review-statistics", actorId, workspaceId, seedId },
    isStatisticsAccessFailure,
    isStatisticsScopeMismatch,
  );
  const { denied } = scope;
  const [filter, setFilter] = useState<StatisticsFilter>(initialReport.filter);
  const [metric, setMetric] = useState<StatisticsActivityMetric>(
    initialMetric ?? defaultStatisticsActivityMetric,
  );
  const [invalidUrl, setInvalidUrl] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [repository, setRepository] = useState<IssueRepository | null>(null);
  const interactionRevision = useRef(0);
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
  const matchesSeed =
    filter.days === initialReport.filter.days &&
    filter.severity === initialReport.filter.severity;
  const query = useQuery({
    queryKey: statisticsReportKey(actorId, workspaceId, seedId, filter),
    queryFn: ({ signal }) =>
      scope.request(
        () => fetchStatisticsReport(workspaceId, filter, signal, actorId),
        (error) => {
          if (isStatisticsScopeMismatch(error)) router.refresh();
        },
      ),
    enabled: !denied && !invalidUrl,
    initialData:
      !denied && scope.seedTrusted && matchesSeed && !invalidUrl
        ? initialReport
        : undefined,
    staleTime: scope.seedTrusted ? 30_000 : 0,
    retry: (failures, error) =>
      !isStatisticsAccessFailure(error) && failures < 1,
  });
  const report =
    denied ||
    invalidUrl ||
    !scope.seedTrusted ||
    isStatisticsAccessFailure(query.error)
      ? undefined
      : query.data;
  useEffect(() => {
    if (!report || query.isFetching || !restoreControlFocus.current) return;
    const control = restoreControlFocus.current;
    restoreControlFocus.current = null;
    // Refresh can disable its initiating button. Restore its initiating
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
    interactionRevision.current += 1;
    restoreControlFocus.current =
      changes.severity !== undefined ? "severity" : null;
    const next = { ...filter, ...changes };
    setRepository(null);
    setInvalidUrl(false);
    setFilter(next);
    const nextUrl = statisticsFilterUrl(window.location.href, next);
    window.history.pushState(
      null,
      "",
      statisticsActivityMetricUrl(
        new URL(nextUrl, window.location.href).href,
        metric,
      ),
    );
  };
  useEffect(() => {
    const pop = () => {
      interactionRevision.current += 1;
      const next = statisticsFilterFromUrl(
        new URLSearchParams(window.location.search),
      );
      const restoredMetric = statisticsActivityMetricFromUrl(
        new URLSearchParams(window.location.search),
      );
      setInvalidUrl(next === null || restoredMetric === null);
      setRepository(null);
      if (next) setFilter(next);
      if (restoredMetric) setMetric(restoredMetric);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
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
          <StatisticsFilterControls
            filter={filter}
            disabled={denied}
            onChange={changeFilter}
          />
          <Button
            ref={refreshControl}
            variant="outline"
            size="sm"
            disabled={!denied && (invalidUrl || query.isFetching)}
            aria-busy={query.isFetching}
            onClick={() => {
              if (denied) {
                router.refresh();
                return;
              }
              restoreControlFocus.current = "refresh";
              const revision = interactionRevision.current;
              void query.refetch().then((result) => {
                if (
                  scope.isActive() &&
                  interactionRevision.current === revision &&
                  result.isSuccess
                )
                  setRepository(null);
              });
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{query.isFetching ? "Refreshing…" : "Refresh"}</span>
          </Button>
        </div>
      </header>
      {denied ? (
        <p role="alert" className={styles.status}>
          Statistics access is no longer available. Use Refresh to open an
          authorized workspace report again.
        </p>
      ) : invalidUrl ? (
        <StatisticsInvalidFilters />
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
              Today in progress · Report generated{" "}
              {instantLabel(report.period.asOf)} UTC
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
              <p className={styles.help}>
                Recent reviews may appear after background processing.
              </p>
              <StatisticsSummary report={report} />
              {report.totals.reviews === 0 ? (
                <p className={styles.empty}>
                  {report.coverage.currentComplete
                    ? "No recorded published reviews in this period yet."
                    : "No recorded reviews in this period. Uncovered activity may be missing."}
                </p>
              ) : null}
              <StatisticsCharts
                report={report}
                metric={metric}
                onMetricChange={(next) => {
                  interactionRevision.current += 1;
                  setMetric(next);
                  setInvalidUrl(false);
                  window.history.pushState(
                    null,
                    "",
                    statisticsActivityMetricUrl(window.location.href, next),
                  );
                }}
                onViewIssues={(row) => {
                  interactionRevision.current += 1;
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
                    interactionRevision.current += 1;
                    setRepository(null);
                    setIssueFocusRequest((request) => request + 1);
                  }}
                  onClose={() => setIssuesOpen(false)}
                  request={scope.request}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
