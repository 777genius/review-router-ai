import type { OutboxEventStatus } from "@reviewrouter/features-outbox";

/** Where the newest repository scan of one GitHub App installation stands. */
export type RepositoryScanState =
  | "scanning"
  | "retrying"
  | "failed"
  | "completed"
  | "unknown";

/** A state as of a read: a scan running past its ceiling is `stalled`. */
export type RepositoryScanProgress = RepositoryScanState | "stalled";

export type RepositoryScanInstallation = {
  readonly githubInstallationId: string;
  readonly accountLogin: string;
  readonly state: RepositoryScanState;
  /** ISO time of the newest scan request; null when none is recorded. */
  readonly requestedAt: string | null;
};

export type RepositoryScanSnapshot = {
  readonly installations: readonly RepositoryScanInstallation[];
  /** Repositories in the workspace now; it grows while a first scan runs. */
  readonly repositoryCount: number;
  /** Web server time of this read. */
  readonly checkedAt: string;
};

export type RepositoryScanSummary =
  | {
      readonly phase: "scanning";
      readonly installations: readonly RepositoryScanInstallation[];
      readonly retrying: boolean;
      /** Running longer than a scan normally takes. */
      readonly slow: boolean;
    }
  | {
      readonly phase: "failed";
      readonly installations: readonly RepositoryScanInstallation[];
      /** None failed outright; their scans never finished. */
      readonly stalled: boolean;
    }
  | { readonly phase: "idle"; readonly completed: boolean };

/**
 * A new installation can reach the dashboard a moment before its first scan
 * request is written by the same webhook; treat that gap as a queued scan.
 */
export const REPOSITORY_SCAN_START_GRACE_MS = 2 * 60_000;
/** A scan normally takes seconds; retries end in a failure within ~2 minutes. */
export const REPOSITORY_SCAN_SLOW_AFTER_MS = 2 * 60_000;
/**
 * Past the 15-minute processing lease a scan is not coming back on its own,
 * for example when no worker processes scans at all: stop polling, offer retry.
 */
export const REPOSITORY_SCAN_STALLED_AFTER_MS = 15 * 60_000;
/** Polling while a scan is expected but not yet visible, e.g. after an install. */
export const REPOSITORY_SCAN_EXPECTED_POLL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 3_000;
const MAX_POLL_INTERVAL_MS = 30_000;

export function repositoryScanStateOf(input: {
  readonly request: {
    readonly status: OutboxEventStatus;
    readonly requestedAt: Date;
  } | null;
  readonly installationCreatedAt: Date;
  readonly now: Date;
}): Pick<RepositoryScanInstallation, "state" | "requestedAt"> {
  const { request } = input;
  if (!request) {
    const queued =
      input.now.getTime() - input.installationCreatedAt.getTime() <
      REPOSITORY_SCAN_START_GRACE_MS;
    return queued
      ? {
          state: "scanning",
          requestedAt: input.installationCreatedAt.toISOString(),
        }
      : { state: "unknown", requestedAt: null };
  }
  return {
    state: scanStateByStatus[request.status],
    requestedAt: request.requestedAt.toISOString(),
  };
}

const scanStateByStatus = {
  pending: "scanning",
  processing: "scanning",
  retry_wait: "retrying",
  processed: "completed",
  dead_letter: "failed",
} as const satisfies Record<OutboxEventStatus, RepositoryScanState>;

export function repositoryScanProgress(
  installation: RepositoryScanInstallation,
  checkedAt: string,
): RepositoryScanProgress {
  return isRunning(installation) &&
    scanAgeMs(installation, checkedAt) > REPOSITORY_SCAN_STALLED_AFTER_MS
    ? "stalled"
    : installation.state;
}

/** A running scan wins over a failed one: its result may replace the failure. */
export function summarizeRepositoryScan(
  snapshot: RepositoryScanSnapshot,
): RepositoryScanSummary {
  const progress = (installation: RepositoryScanInstallation) =>
    repositoryScanProgress(installation, snapshot.checkedAt);
  const running = snapshot.installations.filter(
    (installation) =>
      progress(installation) === "scanning" ||
      progress(installation) === "retrying",
  );
  if (running.length > 0) {
    return {
      phase: "scanning",
      installations: running,
      retrying: running.some(
        (installation) => installation.state === "retrying",
      ),
      slow:
        oldestScanAgeMs(running, snapshot.checkedAt) >
        REPOSITORY_SCAN_SLOW_AFTER_MS,
    };
  }
  const unfinished = snapshot.installations.filter(
    (installation) =>
      progress(installation) === "failed" ||
      progress(installation) === "stalled",
  );
  if (unfinished.length > 0) {
    return {
      phase: "failed",
      installations: unfinished,
      stalled: unfinished.every(
        (installation) => progress(installation) === "stalled",
      ),
    };
  }
  return {
    phase: "idle",
    completed: snapshot.installations.some(
      (installation) => installation.state === "completed",
    ),
  };
}

/**
 * Poll while a scan runs: every 3 s at first, then a quarter of the scan's
 * age, at most every 30 s. Ages compare a database request time with the web
 * server's read time, never the browser clock. While `expectScanForMs` lasts,
 * a not yet visible scan is polled for too.
 */
export function repositoryScanPollIntervalMs(
  snapshot: RepositoryScanSnapshot | undefined,
  expectScanForMs = 0,
): number | false {
  if (!snapshot) return false;
  const summary = summarizeRepositoryScan(snapshot);
  if (summary.phase === "scanning")
    return repositoryScanBackoffMs(
      oldestScanAgeMs(summary.installations, snapshot.checkedAt),
    );
  return expectScanForMs > 0 ? REPOSITORY_SCAN_EXPECTED_POLL_MS : false;
}

export function repositoryScanBackoffMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return MIN_POLL_INTERVAL_MS;
  return Math.min(
    MAX_POLL_INTERVAL_MS,
    Math.max(MIN_POLL_INTERVAL_MS, Math.round(elapsedMs / 4)),
  );
}

/**
 * The finished scan outcome the server-rendered list does not show yet, or
 * null. Callers reload the list once per returned key.
 */
export function repositoryScanListRefreshKey(
  polled: RepositoryScanSnapshot | undefined,
  rendered: RepositoryScanSnapshot,
): string | null {
  if (!polled || summarizeRepositoryScan(polled).phase === "scanning")
    return null;
  const key = scanOutcomeKey(polled);
  return key === scanOutcomeKey(rendered) ? null : key;
}

/** The later of two reads of the same workspace. */
export function isNewerRepositoryScan(
  candidate: RepositoryScanSnapshot,
  current: RepositoryScanSnapshot | undefined,
): boolean {
  return (
    !current || Date.parse(candidate.checkedAt) > Date.parse(current.checkedAt)
  );
}

function scanOutcomeKey(snapshot: RepositoryScanSnapshot): string {
  return JSON.stringify([
    snapshot.repositoryCount,
    snapshot.installations.map((installation) => [
      installation.githubInstallationId,
      installation.state,
      installation.requestedAt,
    ]),
  ]);
}

function isRunning(installation: RepositoryScanInstallation): boolean {
  return installation.state === "scanning" || installation.state === "retrying";
}

function scanAgeMs(
  installation: RepositoryScanInstallation,
  checkedAt: string,
): number {
  return installation.requestedAt
    ? Date.parse(checkedAt) - Date.parse(installation.requestedAt)
    : Number.NaN;
}

function oldestScanAgeMs(
  installations: readonly RepositoryScanInstallation[],
  checkedAt: string,
): number {
  const ages = installations
    .map((installation) => scanAgeMs(installation, checkedAt))
    .filter(Number.isFinite);
  return ages.length > 0 ? Math.max(...ages) : Number.NaN;
}
