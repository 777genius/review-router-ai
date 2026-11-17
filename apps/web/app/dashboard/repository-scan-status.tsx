"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@reviewrouter/ui";
import {
  ageRepositoryScan,
  isNewerRepositoryScan,
  repositoryScanListRefreshKey,
  repositoryScanPollIntervalMs,
  summarizeRepositoryScan,
  type RepositoryScanInstallation,
  type RepositoryScanSnapshot,
} from "../../src/features/repository-scan/repository-scan-model";
import { FormSubmitButton } from "../form-submit-button";
import { requestInstallationSyncClientAction } from "./actions";
import { DashboardActionForm } from "./dashboard-action-form";
import {
  fetchRepositoryScan,
  isRepositoryScanAccessFailure,
  repositoryScanKey,
} from "./repository-scan-api";

export type RepositoryScanScope = {
  readonly actorId: string;
  readonly workspaceId: string;
};

/** A just-rendered read stays current briefly; running scans are polled. */
const REPOSITORY_SCAN_STALE_TIME_MS = 5_000;
/**
 * After an install or access change GitHub may deliver the webhook that
 * starts the scan a moment after the redirect to this page.
 */
const REPOSITORY_SCAN_EXPECT_WINDOW_MS = 60_000;

function useRepositoryScan(
  scope: RepositoryScanScope,
  initialSnapshot: RepositoryScanSnapshot,
  expectScan: boolean,
): RepositoryScanSnapshot | null {
  const { actorId, workspaceId } = scope;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const [{ mountedAt, expectScanUntil }] = useState(() => {
    const now = Date.now();
    return {
      mountedAt: now,
      expectScanUntil: expectScan ? now + REPOSITORY_SCAN_EXPECT_WINDOW_MS : 0,
    };
  });
  // While the route fails, the last read keeps ageing (browser time since the
  // last read; the server render counts from mount), so polling backs off and
  // stops at the stall ceiling.
  const readable = (state: {
    readonly data: RepositoryScanSnapshot | undefined;
    readonly status: string;
    readonly dataUpdateCount: number;
    readonly dataUpdatedAt: number;
  }): RepositoryScanSnapshot | undefined =>
    state.data && state.status === "error"
      ? ageRepositoryScan(
          state.data,
          Date.now() -
            (state.dataUpdateCount > 0 ? state.dataUpdatedAt : mountedAt),
        )
      : state.data;
  const query = useQuery({
    queryKey: repositoryScanKey(actorId, workspaceId),
    queryFn: ({ signal }) => fetchRepositoryScan(workspaceId, signal),
    initialData: initialSnapshot,
    // A server read restored later (for example on Back) is refetched.
    initialDataUpdatedAt: Date.parse(initialSnapshot.checkedAt),
    staleTime: REPOSITORY_SCAN_STALE_TIME_MS,
    // Dropped with the list, so a later visit starts from its own server read.
    gcTime: 0,
    // Polling is the retry; a denied read stops it.
    retry: false,
    refetchInterval: (current) =>
      isRepositoryScanAccessFailure(current.state.error)
        ? false
        : repositoryScanPollIntervalMs(
            readable(current.state),
            expectScanUntil - Date.now(),
          ),
    refetchIntervalInBackground: false,
  });

  // Another dashboard action can re-render the page with a newer read.
  useEffect(() => {
    const queryKey = repositoryScanKey(actorId, workspaceId);
    if (
      isNewerRepositoryScan(
        initialSnapshot,
        queryClient.getQueryData<RepositoryScanSnapshot>(queryKey),
      )
    )
      queryClient.setQueryData(queryKey, initialSnapshot);
  }, [actorId, initialSnapshot, queryClient, workspaceId]);

  // The list is server-rendered: reload it once per finished scan it lacks.
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = repositoryScanListRefreshKey(query.data, initialSnapshot);
    if (!key || refreshedFor.current === key) return;
    refreshedFor.current = key;
    startTransition(() => router.refresh());
  }, [initialSnapshot, query.data, router]);

  if (isRepositoryScanAccessFailure(query.error)) return null;
  const state = queryClient.getQueryState<RepositoryScanSnapshot>(
    repositoryScanKey(actorId, workspaceId),
  );
  return (state ? readable(state) : query.data) ?? null;
}

/**
 * Scan progress for the Repositories list. Shows `children` (the plain empty
 * state) while no scan runs and none failed or stalled.
 */
export function RepositoryScanStatus({
  scope,
  initialSnapshot,
  hasRepositories,
  mutationsEnabled,
  expectScan = false,
  children,
}: {
  readonly scope: RepositoryScanScope;
  readonly initialSnapshot: RepositoryScanSnapshot;
  readonly hasRepositories: boolean;
  readonly mutationsEnabled: boolean;
  /** The page was opened right after an install or access change. */
  readonly expectScan?: boolean;
  readonly children?: ReactNode;
}): React.ReactElement {
  const snapshot = useRepositoryScan(scope, initialSnapshot, expectScan);
  const summary = snapshot ? summarizeRepositoryScan(snapshot) : null;
  let content: ReactNode = children;

  if (snapshot && summary?.phase === "scanning") {
    const accounts = accountList(summary.installations);
    content = hasRepositories ? (
      <p
        role="status"
        className="flex items-center gap-2 border-b border-cyan-200/10 px-4 py-3 text-sm leading-6 text-slate-300 lg:px-6"
      >
        <ScanSpinner />
        Scanning {accounts} on GitHub. New repositories appear here when the
        scan finishes.
      </p>
    ) : (
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="accent">Scanning repositories</Badge>
          <ScanSpinner />
          {snapshot.repositoryCount > 0 ? (
            <span className="text-sm font-semibold text-cyan-50">
              {snapshot.repositoryCount} found so far
            </span>
          ) : null}
        </div>
        <p role="status" className="mt-3 text-sm leading-6 text-slate-300">
          ReviewRouter is reading the repositories of {accounts} from GitHub.
          They appear here automatically when the scan finishes, usually within
          a minute.
        </p>
        {summary.retrying ? (
          <p className="mt-2 text-sm leading-6 text-amber-100">
            The first attempt did not finish, so the scan is retrying
            automatically.
          </p>
        ) : null}
        {summary.slow ? (
          <p className="mt-2 text-sm leading-6 text-slate-400">
            This is taking longer than usual. Keep this page open; the list
            appears as soon as the scan finishes.
          </p>
        ) : null}
      </div>
    );
  } else if (summary?.phase === "failed") {
    const accounts = accountList(summary.installations);
    const retry = summary.installations.map((installation) => (
      <RepositoryScanRequestForm
        key={installation.githubInstallationId}
        workspaceId={scope.workspaceId}
        githubInstallationId={installation.githubInstallationId}
        scanQueryKey={repositoryScanKey(scope.actorId, scope.workspaceId)}
        idleLabel={
          summary.installations.length > 1
            ? `Retry ${installation.accountLogin}`
            : "Retry scan"
        }
        pendingLabel="Retrying..."
        disabled={!mutationsEnabled}
      />
    ));
    const outcome = summary.stalled ? "did not finish" : "failed";
    content = hasRepositories ? (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/10 px-4 py-3 lg:px-6">
        <p
          role="status"
          className="inline-flex items-center gap-2 text-sm leading-6 text-amber-100"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          The last repository scan of {accounts} {outcome}, so this list may be
          out of date.
        </p>
        <div className="flex flex-wrap gap-2">{retry}</div>
      </div>
    ) : summary.stalled ? (
      <div className="p-5">
        <Badge tone="warning">Scan did not finish</Badge>
        <p role="status" className="mt-3 text-sm leading-6 text-slate-300">
          The repository scan of {accounts} started more than 15 minutes ago and
          has not finished. Try the scan again. If it still does not finish,
          contact support.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">{retry}</div>
      </div>
    ) : (
      <div className="p-5">
        <Badge tone="danger">Repository scan failed</Badge>
        <p role="status" className="mt-3 text-sm leading-6 text-slate-300">
          ReviewRouter could not read the repositories of {accounts} from
          GitHub. Try the scan again. If it keeps failing, check that the GitHub
          App is still installed and has access to repositories.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">{retry}</div>
      </div>
    );
  }

  return <>{content}</>;
}

/**
 * Requests a repository scan through the existing dashboard sync action, then
 * refetches the watched scan query so its polling starts right away.
 */
export function RepositoryScanRequestForm({
  workspaceId,
  githubInstallationId,
  scanQueryKey,
  idleLabel,
  pendingLabel,
  disabled,
  className,
}: {
  readonly workspaceId: string;
  readonly githubInstallationId: string;
  readonly scanQueryKey: ReturnType<typeof repositoryScanKey> | null;
  readonly idleLabel: string;
  readonly pendingLabel: string;
  readonly disabled: boolean;
  readonly className?: string;
}): React.ReactElement {
  const queryClient = useQueryClient();

  return (
    <DashboardActionForm
      action={requestInstallationSyncClientAction}
      fallbackParams={{
        error: "dashboard_action_failed",
        workspace: workspaceId,
        section: "repositories",
      }}
      refresh={false}
      onComplete={(params) => {
        if (!scanQueryKey || params.error) return;
        void queryClient.invalidateQueries({
          queryKey: scanQueryKey,
          exact: true,
        });
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input
        type="hidden"
        name="githubInstallationId"
        value={githubInstallationId}
      />
      <FormSubmitButton
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled}
        idleLabel={idleLabel}
        pendingLabel={pendingLabel}
      />
    </DashboardActionForm>
  );
}

function ScanSpinner(): React.ReactElement {
  return (
    <LoaderCircle
      aria-hidden="true"
      className="size-4 shrink-0 text-cyan-200 motion-safe:animate-spin"
    />
  );
}

function accountList(
  installations: readonly RepositoryScanInstallation[],
): string {
  const logins = installations.map((installation) => installation.accountLogin);
  return logins.length > 1
    ? `${logins.slice(0, -1).join(", ")} and ${logins.at(-1)}`
    : (logins[0] ?? "this workspace");
}
