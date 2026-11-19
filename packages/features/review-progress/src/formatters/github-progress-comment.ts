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
  const multiPart = counts.requiredTotal >= 2;
  const details = [
    ...(multiPart
      ? partsProgressLines(counts.requiredCompleted, counts.requiredTotal)
      : []),
    ...(snapshot.fileCoverage.valid
      ? [
          `Files fully reviewed: ${snapshot.fileCoverage.covered} of ${snapshot.fileCoverage.total}`,
          `Files not assigned to any part: ${snapshot.fileCoverage.uncovered}`,
          `Files skipped (unavailable or excluded): ${snapshot.fileCoverage.excluded}`,
        ]
      : []),
    ...nonZeroLine("Parts being retried", counts.retrying),
    ...nonZeroLine("Parts finished after a retry", counts.recovered),
    ...nonZeroLine("Parts that could not be finished", counts.exhausted),
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
      : "This review runs as one part, so the comment shows its phase instead of a percentage.",
    "Updates are best effort, so this comment can lag a little behind the review.",
    "",
    "</details>",
  ].join("\n");
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
    complete_with_gaps: "Complete with gaps",
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
