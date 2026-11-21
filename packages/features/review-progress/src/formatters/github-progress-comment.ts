import type {
  ProgressPhase,
  ProgressSnapshot,
  ProgressTerminal,
} from "../domain/review-progress";

export const githubProgressCommentMarker =
  "<!-- review-router-live-progress -->";
export const githubProgressSourceIdentityMarkerPrefix =
  "<!-- review-router-live-progress-source ";

export function formatGithubProgressSourceIdentityMarker(
  sourceRunId: string,
  sourceRunAttempt: string,
): string {
  if (!/^[1-9][0-9]{0,19}$/u.test(sourceRunId)) {
    throw new Error("progress_source_run_id_invalid");
  }
  if (!/^[1-9][0-9]{0,9}$/u.test(sourceRunAttempt)) {
    throw new Error("progress_source_run_attempt_invalid");
  }
  return `${githubProgressSourceIdentityMarkerPrefix}run-id=${sourceRunId} run-attempt=${sourceRunAttempt} -->`;
}

export function parseGithubProgressSourceIdentity(
  body: string,
): { readonly sourceRunId: string; readonly sourceRunAttempt: string } | null {
  const sourceLines = body
    .split(/\r?\n/u)
    .filter((line) => line.includes(githubProgressSourceIdentityMarkerPrefix));
  if (sourceLines.length === 0) return null;
  if (sourceLines.length !== 1) {
    throw new Error("progress_source_identity_marker_invalid");
  }
  const match =
    /^<!-- review-router-live-progress-source run-id=([1-9][0-9]{0,19}) run-attempt=([1-9][0-9]{0,9}) -->$/u.exec(
      sourceLines[0]!,
    );
  if (match === null) {
    throw new Error("progress_source_identity_marker_invalid");
  }
  return { sourceRunId: match[1]!, sourceRunAttempt: match[2]! };
}

export function formatGithubProgressComment(
  snapshot: ProgressSnapshot,
): string {
  const { counts } = snapshot;
  // A review the server covered counts only the parts that covered it. An
  // ordered fallback completes once one reviewer covers the review: the parts
  // of later reviewers were not needed. A part that did not finish there (an
  // optional part such as the PR description, or a reviewer that another one
  // covered: an ordered fallback or a quota skip, plans 67 and 69) left no gap,
  // so it is not listed as unfinished. The summary can still call such a
  // review incomplete (for example unverified native spans).
  const terminal = snapshot.phase === "terminal";
  const covered =
    terminal &&
    (snapshot.terminal === "complete" ||
      (snapshot.terminal === "complete_with_gaps" &&
        snapshot.requiredCoverageComplete === true));
  const incomplete = terminal && snapshot.terminal === "complete_with_gaps";
  const partsNotNeeded = covered ? counts.requiredCancelled : 0;
  const partsTotal = covered ? counts.requiredCompleted : counts.requiredTotal;
  const multiPart = partsTotal >= 2;
  const details = [
    // Same verdict as the summary's "Review incomplete"; parts can all be
    // finished while some findings could not be verified.
    ...(incomplete
      ? [
          "Some of the review could not be finished or verified. The review summary explains why.",
        ]
      : []),
    ...(multiPart
      ? partsProgressLines(counts.requiredCompleted, partsTotal)
      : []),
    ...nonZeroLine("Parts not needed", partsNotNeeded),
    ...(snapshot.fileCoverage.valid
      ? [
          // Counts follow accepted parts. An incomplete review can accept a
          // part that stopped early (plan 87), so only the summary knows which
          // files were really reviewed; never claim them here. With no part
          // accepted, "0 of N" is still a true count.
          ...(incomplete && counts.requiredCompleted > 0
            ? []
            : [
                `Files fully reviewed: ${snapshot.fileCoverage.covered} of ${snapshot.fileCoverage.total}`,
              ]),
          `Files not assigned to any part: ${snapshot.fileCoverage.uncovered}`,
          `Files skipped (unavailable or excluded): ${snapshot.fileCoverage.excluded}`,
        ]
      : []),
    ...nonZeroLine("Parts being retried", counts.retrying),
    ...nonZeroLine("Parts finished after a retry", counts.recovered),
    ...nonZeroLine(
      "Parts that could not be finished",
      covered ? 0 : counts.exhausted,
    ),
  ];
  return [
    githubProgressCommentMarker,
    ...(snapshot.sourceIdentity === undefined
      ? []
      : [
          formatGithubProgressSourceIdentityMarker(
            snapshot.sourceIdentity.sourceRunId,
            snapshot.sourceIdentity.sourceRunAttempt,
          ),
        ]),
    "## ReviewRouter",
    "",
    `**Phase:** ${phaseLabel(snapshot.phase, snapshot.terminal)}`,
    "",
    ...(details.length === 0 ? [] : [...details, ""]),
    ...(snapshot.startedAt === undefined
      ? []
      : [`Started: ${formatUtc(snapshot.startedAt)}`]),
    `Last update: ${formatUtc(snapshot.updatedAt)}`,
    "",
    "<details>",
    "<summary>How progress is measured</summary>",
    "",
    multiPart
      ? "The review is split into parts, and the percentage is the share of parts that are finished, not a time estimate."
      : "The comment shows the review phase; a percentage appears only when the review is split into two or more parts.",
    "Updates are best effort, so this comment can lag a little behind the review.",
    "",
    "</details>",
  ].join("\n");
}

/**
 * Plan 88: the progress comment while the review's GitHub Actions job is
 * still queued without a runner. The review's own progress replaces it once
 * the job starts; the absolute end time shows when the text is outdated.
 */
export function formatGithubProgressWaitingForRunnerComment(input: {
  readonly headSha: string;
  readonly queuedSince: string;
  readonly queuedUntil: string;
  readonly updatedAt: string;
}): string {
  return startNoticeComment(
    "Waiting for a runner",
    [
      `The review of commit \`${shortHeadSha(input.headSha)}\` has been waiting for a GitHub Actions runner since ${formatUtc(input.queuedSince)}. It starts by itself when GitHub assigns one. ReviewRouter keeps it queued until about ${formatUtc(input.queuedUntil)}.`,
    ],
    input.updatedAt,
  );
}

/**
 * Plan 88: the progress comment of a review whose run never reached
 * ReviewRouter, either because GitHub gave its job no runner or because the
 * job got one too late or stopped before it checked in. The next review
 * replaces it.
 */
export function formatGithubProgressNotStartedComment(input: {
  readonly headSha: string;
  readonly waitedMinutes: number;
  readonly runnerAssigned: boolean;
  readonly runUrl: string;
  readonly updatedAt: string;
}): string {
  if (!Number.isSafeInteger(input.waitedMinutes) || input.waitedMinutes < 1) {
    throw new Error("progress_start_notice_minutes_invalid");
  }
  if (!/^https:\/\/github\.com\/[^\s()]+$/u.test(input.runUrl)) {
    throw new Error("progress_start_notice_run_url_invalid");
  }
  const cause = input.runnerAssigned
    ? `the review job did not reach ReviewRouter within ${input.waitedMinutes} minutes.`
    : `GitHub Actions did not give the review job a runner within ${input.waitedMinutes} minutes.`;
  return startNoticeComment(
    "Not started",
    [
      `The review of commit \`${shortHeadSha(input.headSha)}\` did not start: ${cause}`,
      "",
      `To try again, push a new commit or re-run [the ReviewRouter run](${input.runUrl}).`,
    ],
    input.updatedAt,
  );
}

function startNoticeComment(
  phase: string,
  details: readonly string[],
  updatedAt: string,
): string {
  return [
    githubProgressCommentMarker,
    "## ReviewRouter",
    "",
    `**Phase:** ${phase}`,
    "",
    ...details,
    "",
    `Last update: ${formatUtc(updatedAt)}`,
  ].join("\n");
}

function shortHeadSha(headSha: string): string {
  if (!/^[0-9a-f]{40}$/iu.test(headSha)) {
    throw new Error("progress_start_notice_head_invalid");
  }
  return headSha.slice(0, 12);
}

function phaseLabel(phase: ProgressPhase, terminal: ProgressTerminal): string {
  if (phase !== "terminal") {
    return {
      preparing: "Preparing",
      reviewing: "Reviewing",
      assembling: "Assembling results",
      publishing: "Publishing results",
    }[phase];
  }
  return {
    none: "Finished",
    complete: "Complete",
    complete_with_gaps: "Review incomplete",
    failed: "Failed",
    cancelled: "Cancelled",
    superseded: "Superseded",
  }[terminal];
}

/**
 * Most reviews run as one part, where a percentage would only jump from 0% to
 * 100%, so callers show the part count and bar only for two or more parts.
 */
function partsProgressLines(completed: number, total: number): string[] {
  const percent = percentage(completed, total);
  return [
    `Progress: ${completed} of ${total} parts reviewed (${percent}%)`,
    `${progressBar(percent)} ${percent}%`,
  ];
}

function nonZeroLine(label: string, value: number): string[] {
  return value === 0 ? [] : [`${label}: ${value}`];
}

function percentage(completed: number, total: number): number {
  return Math.floor((completed / total) * 100);
}

function progressBar(percent: number): string {
  const filled = Math.floor(percent / 10);
  return `[${"■".repeat(filled)}${"□".repeat(10 - filled)}]`;
}

function formatUtc(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
