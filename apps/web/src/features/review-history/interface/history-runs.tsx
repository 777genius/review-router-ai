"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Badge, Button } from "@reviewrouter/ui";
import {
  fetchHistoryRuns,
  historyRunsKey,
  isHistoryAccessFailure,
} from "../adapters/history-api";
import {
  historyInstant,
  historyStatusLabels,
  historyStatusTone,
} from "../application/history-presentation";
import { useHistoryScope } from "./history-scope";
import styles from "./history.module.css";

export function HistoryRuns({
  pullRequestId,
  refresh,
}: {
  pullRequestId: string;
  refresh: number;
}) {
  const scope = useHistoryScope();
  const end = useRef<HTMLLIElement>(null);
  const moreOrigin = useRef<Element | null>(null);
  const query = useInfiniteQuery({
    queryKey: historyRunsKey(
      scope.actorId,
      scope.workspaceId,
      scope.seedId,
      pullRequestId,
      refresh,
    ),
    queryFn: ({ pageParam, signal }) =>
      scope.request(() =>
        fetchHistoryRuns(scope.workspaceId, pullRequestId, pageParam, signal),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !scope.denied,
    staleTime: 30_000,
    retry: (failures, error) => !isHistoryAccessFailure(error) && failures < 1,
  });
  const runs = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((run) => [run.id, run]) ?? [],
    ).values(),
  ];
  useEffect(() => {
    if (!moreOrigin.current || query.isFetchingNextPage) return;
    const origin = moreOrigin.current;
    moreOrigin.current = null;
    if (
      !query.hasNextPage &&
      (document.activeElement === origin ||
        document.activeElement === document.body)
    )
      end.current?.focus({ preventScroll: true });
  }, [query.data, query.isFetchingNextPage, query.hasNextPage]);
  if (scope.denied) return null;
  if (!query.data)
    return (
      <div
        role={query.isError ? "alert" : "status"}
        className={styles.localStatus}
      >
        {query.isError ? (
          <>
            History could not be loaded.{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Try loading again
            </Button>
          </>
        ) : (
          <>
            <span className={styles.skeleton} aria-hidden="true" />
            Loading review history…
          </>
        )}
      </div>
    );
  return (
    <>
      {query.isError ? (
        <p role="alert" className={styles.notice}>
          History refresh failed. Showing the last available history.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Try loading again
          </Button>
        </p>
      ) : null}
      {runs.length ? (
        <ol className={styles.runList} aria-label="Previous review runs">
          {runs.map((run, index) => (
            <li
              key={run.id}
              className={styles.run}
              ref={index === runs.length - 1 ? end : undefined}
              tabIndex={-1}
            >
              <Badge
                size="xs"
                className={styles.statusBadge}
                tone={historyStatusTone(run.status)}
              >
                {historyStatusLabels[run.status]}
              </Badge>
              <time dateTime={run.requestedAt}>
                Requested {historyInstant(run.requestedAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.localStatus}>
          Review history is not available for this pull request.
        </p>
      )}
      {query.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetchingNextPage}
          aria-busy={query.isFetchingNextPage}
          onClick={() => {
            moreOrigin.current = document.activeElement;
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage
            ? "Loading older reviews…"
            : "Show older reviews"}
        </Button>
      ) : null}
      <span role="status" className={styles.srOnly}>
        {query.isFetchingNextPage
          ? "Loading older reviews"
          : `${runs.length} reviews shown`}
      </span>
    </>
  );
}
