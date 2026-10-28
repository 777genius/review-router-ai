"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button, SelectField, TextField } from "@reviewrouter/ui";
import { RefreshCw } from "lucide-react";
import type {
  HistoryFilters,
  HistoryPullRequestPage,
  HistoryRepositoryPage,
} from "@reviewrouter/features-review-history/contracts";
import {
  fetchHistoryList,
  historyListKey,
  historyScopeKey,
  isHistoryAccessFailure,
  HistoryRequestError,
} from "../adapters/history-api";
import {
  defaultHistoryFilters,
  historyDay,
  historyFilterProblem,
  historyFiltersFromUrl,
  historyFiltersUrl,
} from "../application/history-presentation";
import { HistoryScope, useHistoryScope } from "./history-scope";
import { HistoryRepositoryFilter } from "./history-repository-filter";
import { HistoryRow } from "./history-row";
import styles from "./history.module.css";

export type HistoryViewProps = {
  actorId: string;
  workspaceId: string;
  seedId: string;
  initialFilters: HistoryFilters;
  initialPage: HistoryPullRequestPage | null;
  initialRepositories: HistoryRepositoryPage | null;
  initialError?: number;
};
export function HistoryView(props: HistoryViewProps) {
  const client = useQueryClient();
  const previousScope = useRef({
    actorId: props.actorId,
    workspaceId: props.workspaceId,
  });
  useEffect(() => {
    const departed = previousScope.current;
    previousScope.current = {
      actorId: props.actorId,
      workspaceId: props.workspaceId,
    };
    if (
      departed.actorId === props.actorId &&
      departed.workspaceId === props.workspaceId
    )
      return;
    const queryKey = historyScopeKey(departed.actorId, departed.workspaceId);
    void client.cancelQueries({ queryKey });
    client.removeQueries({ queryKey });
  }, [props.actorId, props.workspaceId, client]);
  return (
    <HistoryScope
      key={JSON.stringify([props.actorId, props.workspaceId, props.seedId])}
      actorId={props.actorId}
      workspaceId={props.workspaceId}
      seedId={props.seedId}
    >
      <HistoryInstance {...props} />
    </HistoryScope>
  );
}
function HistoryInstance({
  initialFilters,
  initialPage,
  initialRepositories,
  initialError,
}: HistoryViewProps) {
  const scope = useHistoryScope();
  const client = useQueryClient();
  const router = useRouter();
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState(initialFilters.q);
  const [windowToken, setWindowToken] = useState(
    initialPage?.windowToken ?? null,
  );
  const [cursors, setCursors] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusRequest = useRef<{ origin: Element | null; key: string } | null>(
    null,
  );
  const cursor = cursors.at(-1) ?? windowToken;
  const queryKey = historyListKey(
    scope.actorId,
    scope.workspaceId,
    scope.seedId,
    filters,
    cursor,
    revision,
  );
  const key = JSON.stringify(queryKey);
  const problem =
    historyFilterProblem(filters) ??
    (revision === 0 && initialError === 400
      ? "Check your filters or clear them to continue."
      : null);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      scope.request(() =>
        fetchHistoryList(scope.workspaceId, filters, cursor, signal),
      ),
    initialData:
      !scope.denied &&
      scope.seedTrusted &&
      revision === 0 &&
      cursor === initialPage?.windowToken &&
      JSON.stringify(filters) === JSON.stringify(initialFilters)
        ? (initialPage ?? undefined)
        : undefined,
    enabled: !scope.denied && !problem,
    staleTime: 30_000,
    retry: (failures, error) =>
      !isHistoryAccessFailure(error) &&
      !(error instanceof HistoryRequestError && error.status === 400) &&
      failures < 1,
  });
  const page =
    !scope.denied && !problem && !isHistoryAccessFailure(query.error)
      ? query.data
      : undefined;
  // Adopt the server's fixed date window without making a second first-page read.
  useEffect(() => {
    if (!page || windowToken || cursors.length || scope.denied) return;
    client.setQueryData(
      historyListKey(
        scope.actorId,
        scope.workspaceId,
        scope.seedId,
        filters,
        page.windowToken,
        revision,
      ),
      page,
    );
    setWindowToken(page.windowToken);
  }, [
    page,
    windowToken,
    cursors.length,
    scope.denied,
    scope.actorId,
    scope.workspaceId,
    scope.seedId,
    filters,
    revision,
    client,
  ]);
  const changeFilters = useCallback((next: HistoryFilters, writeUrl = true) => {
    focusRequest.current = null;
    setFilters(next);
    setSearch(next.q);
    setWindowToken(null);
    setCursors([]);
    setRevision((current) => current + 1);
    if (writeUrl) window.history.pushState(null, "", historyFiltersUrl(next));
  }, []);
  useEffect(() => {
    if (search === filters.q || scope.denied) return;
    const timeout = setTimeout(
      () => changeFilters({ ...filters, q: search }),
      300,
    );
    return () => clearTimeout(timeout);
  }, [search, filters, changeFilters, scope.denied]);
  useEffect(() => {
    const pop = () =>
      changeFilters(
        historyFiltersFromUrl(new URLSearchParams(window.location.search)),
        false,
      );
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [changeFilters]);
  useEffect(() => {
    const pending = focusRequest.current;
    if (!pending || query.isFetching || !page || pending.key === key) return;
    focusRequest.current = null;
    if (
      document.activeElement !== pending.origin &&
      document.activeElement !== document.body
    )
      return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "start" });
  }, [page, query.isFetching, key]);
  const filtered =
    filters.q !== "" ||
    filters.repositoryId !== null ||
    filters.status !== "all" ||
    filters.days !== null;
  const loadProblem =
    query.error instanceof HistoryRequestError && query.error.status === 400;
  return (
    <section
      id="dashboard-section-content"
      className={styles.root}
      aria-label="Review history"
    >
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Reviews</h1>
          <p className={styles.subtitle}>
            Find a pull request and see how its latest review is going.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-busy={query.isFetching}
          onClick={() => {
            if (scope.denied) {
              router.refresh();
              return;
            }
            focusRequest.current = null;
            setWindowToken(null);
            setCursors([]);
            setRevision((current) => current + 1);
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>
      <div className={styles.filters}>
        <TextField
          label="Search"
          type="search"
          name="review-search"
          placeholder="PR title, #number, or repository"
          value={search}
          disabled={scope.denied}
          onChange={(event) => setSearch(event.target.value)}
        />
        <HistoryRepositoryFilter
          value={filters.repositoryId}
          initialValue={initialFilters.repositoryId}
          initialPage={initialRepositories}
          onChange={(repositoryId) =>
            changeFilters({ ...filters, q: search, repositoryId })
          }
        />
        <SelectField
          name="review-status"
          label="Status"
          value={filters.status}
          disabled={scope.denied}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "In progress" },
            { value: "completed", label: "Completed" },
            { value: "attention", label: "Needs attention" },
          ]}
          onValueChange={(status) =>
            changeFilters({
              ...filters,
              q: search,
              status: status as HistoryFilters["status"],
            })
          }
        />
        <SelectField
          name="review-days"
          label="Period"
          value={filters.days ? String(filters.days) : "all"}
          disabled={scope.denied}
          options={[
            { value: "all", label: "Any time" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
          onValueChange={(days) =>
            changeFilters({
              ...filters,
              q: search,
              days: days === "all" ? null : (Number(days) as 7 | 30 | 90),
            })
          }
        />
      </div>
      {filtered && !scope.denied ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => changeFilters(defaultHistoryFilters)}
        >
          Clear filters
        </Button>
      ) : null}
      {scope.denied ? (
        <p role="alert" className={styles.status}>
          Review history access is no longer available. Use Refresh to open an
          authorized workspace again.
        </p>
      ) : problem || loadProblem ? (
        <p role="alert" className={styles.status}>
          {problem ?? "Check your filters or clear them to continue."}
          {!filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => changeFilters(defaultHistoryFilters)}
            >
              Clear filters
            </Button>
          ) : null}
        </p>
      ) : !page ? (
        <div
          className={styles.status}
          role={query.isError ? "alert" : "status"}
        >
          {query.isError ? (
            <>
              Reviews could not be loaded.{" "}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try loading again
              </Button>
            </>
          ) : (
            <>
              <span className={styles.skeleton} aria-hidden="true" />
              Loading reviews…
            </>
          )}
        </div>
      ) : (
        <>
          {query.isError ? (
            <p role="alert" className={styles.notice}>
              Refresh failed. Showing the last available history.{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try loading again
              </Button>
            </p>
          ) : null}
          {page.coverage.state === "unavailable" ? (
            <p className={styles.status}>
              Review history is not available yet for this workspace.
            </p>
          ) : (
            <>
              <p className={styles.coverage}>
                Review history available since{" "}
                {historyDay(page.coverage.availableSince)}. Dates are UTC.
              </p>
              <h2 className={styles.srOnly} tabIndex={-1} ref={heading}>
                Pull requests
              </h2>
              {page.items.length ? (
                <ul className={styles.rows} aria-label="Reviewed pull requests">
                  {page.items.map((row) => (
                    <HistoryRow
                      key={`${revision}-${row.id}`}
                      row={row}
                      refresh={revision}
                    />
                  ))}
                </ul>
              ) : (
                <div className={styles.empty}>
                  <p>{filtered ? "No matching reviews." : "No reviews yet."}</p>
                  <p>
                    {filtered
                      ? "Try different filters to find a pull request."
                      : "Supported GitHub reviews will appear here when ReviewRouter receives a review request."}
                  </p>
                </div>
              )}
              <nav className={styles.pagination} aria-label="Review pages">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!cursors.length || query.isFetching}
                  onClick={() => {
                    focusRequest.current = {
                      origin: document.activeElement,
                      key,
                    };
                    setCursors((current) => current.slice(0, -1));
                  }}
                >
                  Previous
                </Button>
                <span>Page {cursors.length + 1}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!page.nextCursor || query.isFetching}
                  onClick={() => {
                    if (!page.nextCursor) return;
                    focusRequest.current = {
                      origin: document.activeElement,
                      key,
                    };
                    setCursors((current) => [...current, page.nextCursor!]);
                  }}
                >
                  Next
                </Button>
              </nav>
            </>
          )}
        </>
      )}
      <span role="status" className={styles.srOnly}>
        {scope.denied || problem
          ? ""
          : query.isFetching
            ? "Loading reviews"
            : page
              ? `Page ${cursors.length + 1} loaded`
              : ""}
      </span>
    </section>
  );
}
