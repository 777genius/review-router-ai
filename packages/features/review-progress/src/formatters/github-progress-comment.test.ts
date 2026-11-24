import { describe, expect, it } from "vitest";
import {
  computeProgressSnapshot,
  type ReviewSlotProgressInput,
} from "../domain/review-progress";
import {
  formatGithubProgressComment,
  formatGithubProgressNotStartedComment,
  formatGithubProgressWaitingForRunnerComment,
  githubProgressCommentMarker,
  parseGithubProgressSourceIdentity,
} from "./github-progress-comment";

describe("formatGithubProgressComment", () => {
  it("renders the accepted ReviewRouter progress UX", () => {
    const slots: ReviewSlotProgressInput[] = Array.from(
      { length: 72 },
      (_, index) => ({
        slotId: `unit-${index}`,
        required: true,
        state:
          index < 42
            ? "accepted"
            : index === 42
              ? "running"
              : index === 43
                ? "exhausted"
                : "pending",
        ...(index === 0 || index === 42 ? { attemptOrdinal: 2 } : {}),
      }),
    );
    const snapshot = computeProgressSnapshot({
      generation: 1,
      sourceIdentity: { sourceRunId: "700001", sourceRunAttempt: "2" },
      phase: "reviewing",
      terminal: "none",
      startedAt: "2026-08-12T16:58:00.000Z",
      updatedAt: "2026-08-12T17:04:05.000Z",
      slots,
      assignmentManifest: {
        paths: [
          {
            pathId: "opaque",
            disposition: "renamed",
            requiredCoveringSlotIds: ["unit-0"],
          },
        ],
      },
    });
    const comment = formatGithubProgressComment(snapshot);
    expect(comment.split(githubProgressCommentMarker)).toHaveLength(2);
    expect(comment).toContain(
      "<!-- review-router-live-progress-source run-id=700001 run-attempt=2 -->",
    );
    expect(comment).toContain("## ReviewRouter");
    expect(comment).toContain("**Phase:** Reviewing");
    expect(comment).toContain("Progress: 42 of 72 parts reviewed (58%)");
    expect(comment).toContain("[■■■■■□□□□□] 58%");
    expect(comment).toContain("Files fully reviewed: 1 of 1");
    expect(comment).toContain("Files not assigned to any part: 0");
    expect(comment).toContain("Files skipped (unavailable or excluded): 0");
    expect(comment).toContain("Parts being retried: 1");
    expect(comment).toContain("Parts finished after a retry: 1");
    expect(comment).toContain("Parts that could not be finished: 1");
    expect(comment).toContain(
      "Started: 2026-08-12 16:58:00 UTC\nLast update: 2026-08-12 17:04:05 UTC",
    );
    expect(comment).toContain(
      "The review is split into parts, and the percentage is the share of parts that are finished, not a time estimate.\nUpdates are best effort, so this comment can lag a little behind the review.",
    );
  });

  it("keeps the marker first and hides retry lines while nothing was retried", () => {
    const comment = formatGithubProgressComment(
      computeProgressSnapshot({
        generation: 1,
        sourceIdentity: { sourceRunId: "700001", sourceRunAttempt: "1" },
        phase: "reviewing",
        terminal: "none",
        updatedAt: "2026-08-12T17:00:00.000Z",
        slots: [
          { slotId: "a", required: true, state: "accepted" },
          { slotId: "b", required: true, state: "running" },
          { slotId: "c", required: true, state: "pending" },
        ],
      }),
    );
    expect(comment).toBe(
      [
        githubProgressCommentMarker,
        "<!-- review-router-live-progress-source run-id=700001 run-attempt=1 -->",
        "## ReviewRouter",
        "",
        "**Phase:** Reviewing",
        "",
        "Progress: 1 of 3 parts reviewed (33%)",
        "[■■■□□□□□□□] 33%",
        "",
        "Last update: 2026-08-12 17:00:00 UTC",
        "",
        "<details>",
        "<summary>How progress is measured</summary>",
        "",
        "The review is split into parts, and the percentage is the share of parts that are finished, not a time estimate.",
        "Updates are best effort, so this comment can lag a little behind the review.",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("keeps legacy snapshots identity-less and rejects marker injection", () => {
    const legacy = computeProgressSnapshot({
      generation: 1,
      phase: "reviewing",
      terminal: "none",
      updatedAt: "2026-08-12T17:00:00Z",
      slots: [],
    });
    expect(formatGithubProgressComment(legacy)).not.toContain(
      "review-router-live-progress-source",
    );
    expect(() =>
      computeProgressSnapshot({
        generation: 1,
        phase: "reviewing",
        terminal: "none",
        updatedAt: "2026-08-12T17:00:00Z",
        slots: [],
        sourceIdentity: {
          sourceRunId: "7 --> hostile",
          sourceRunAttempt: "1",
        },
      }),
    ).toThrow("progress_source_run_id_invalid");
  });

  it("parses only one exact canonical source marker", () => {
    expect(
      parseGithubProgressSourceIdentity(
        `${githubProgressCommentMarker}\n<!-- review-router-live-progress-source run-id=700001 run-attempt=2 -->`,
      ),
    ).toEqual({ sourceRunId: "700001", sourceRunAttempt: "2" });
    expect(parseGithubProgressSourceIdentity(githubProgressCommentMarker)).toBe(
      null,
    );
    expect(() =>
      parseGithubProgressSourceIdentity(
        "<!-- review-router-live-progress-source run-id=0700001 run-attempt=2 -->",
      ),
    ).toThrow("progress_source_identity_marker_invalid");
    expect(() =>
      parseGithubProgressSourceIdentity(
        "<!-- review-router-live-progress-source run-id=700001 run-attempt=2 -->\n<!-- review-router-live-progress-source run-id=700001 run-attempt=3 -->",
      ),
    ).toThrow("progress_source_identity_marker_invalid");
  });

  it("labels complete-with-gaps honestly and leaks no identities", () => {
    const comment = formatGithubProgressComment(
      computeProgressSnapshot({
        generation: 1,
        phase: "terminal",
        terminal: "complete_with_gaps",
        allowPartial: true,
        updatedAt: "2026-08-12T17:00:00Z",
        slots: [
          {
            slotId: "provider-model-agent",
            required: true,
            state: "exhausted",
          },
        ],
        assignmentManifest: {
          paths: [
            {
              pathId: "private/path.ts",
              disposition: "reviewable",
              requiredCoveringSlotIds: ["unknown"],
            },
          ],
        },
      }),
    );
    expect(comment).toContain("**Phase:** Review incomplete");
    expect(comment).toContain(
      "Some of the review could not be finished or verified. The review summary explains why.",
    );
    expect(comment).not.toContain("Files fully reviewed");
    expect(comment).toContain("Parts that could not be finished: 1");
    expect(comment).not.toContain("provider-model-agent");
    expect(comment).not.toContain("private/path.ts");
    expect(comment).not.toMatch(/\bETA\b|raw error/i);
  });

  it("shows an ordered fallback as fully reviewed by the parts it needed", () => {
    const snapshot = computeProgressSnapshot({
      generation: 1,
      phase: "assembling",
      terminal: "none",
      updatedAt: "2026-08-12T17:00:00Z",
      slots: [
        { slotId: "first-1", required: true, state: "exhausted" },
        { slotId: "second-1", required: true, state: "accepted" },
        { slotId: "second-2", required: true, state: "accepted" },
        { slotId: "third-1", required: true, state: "cancelled" },
      ],
    });
    const comment = formatGithubProgressComment({
      ...snapshot,
      phase: "terminal",
      terminal: "complete",
    });
    expect(comment).toContain("**Phase:** Complete");
    expect(comment).toContain("Progress: 2 of 2 parts reviewed (100%)");
    expect(comment).toContain("Parts not needed: 1");
    // The failed first reviewer was replaced, so Complete shows no gap.
    expect(comment).not.toContain("could not be finished");

    // While the review runs, every required part still counts.
    expect(formatGithubProgressComment(snapshot)).toContain(
      "Progress: 2 of 4 parts reviewed (50%)",
    );
    expect(formatGithubProgressComment(snapshot)).toContain(
      "Parts that could not be finished: 1",
    );
  });

  it("says incomplete without unfinished parts when spans could not be verified", () => {
    const comment = formatGithubProgressComment(
      computeProgressSnapshot({
        generation: 1,
        phase: "terminal",
        terminal: "complete_with_gaps",
        updatedAt: "2026-08-12T17:00:00Z",
        slots: [
          { slotId: "one", required: true, state: "accepted" },
          { slotId: "two", required: true, state: "accepted" },
        ],
        assignmentManifest: {
          paths: [
            {
              pathId: "opaque",
              disposition: "reviewable",
              requiredCoveringSlotIds: ["one"],
            },
          ],
        },
      }),
    );
    // An accepted part can be a partial engine run: only the summary knows
    // which files were really reviewed.
    expect(comment).not.toContain("Files fully reviewed");
    expect(comment).toContain("Files not assigned to any part: 0");
    expect(comment).toContain("**Phase:** Review incomplete");
    expect(comment).toContain("could not be finished or verified");
    expect(comment).toContain("Progress: 2 of 2 parts reviewed (100%)");
    expect(comment).not.toContain("Parts that could not be finished");
    expect(comment).not.toContain("**Phase:** Complete");
  });

  it("keeps a true 0 of N on a lost review and hides the count once a part was accepted", () => {
    const manifest = {
      paths: [
        {
          pathId: "opaque",
          disposition: "reviewable" as const,
          requiredCoveringSlotIds: ["first-1", "second-1"],
        },
      ],
    };
    const terminal = (states: ("accepted" | "exhausted")[]) =>
      formatGithubProgressComment(
        computeProgressSnapshot({
          generation: 1,
          phase: "terminal",
          terminal: "complete_with_gaps",
          updatedAt: "2026-08-12T17:00:00Z",
          slots: [
            { slotId: "first-1", required: true, state: states[0]! },
            { slotId: "second-1", required: true, state: states[1]! },
          ],
          assignmentManifest: manifest,
        }),
      );
    // Nothing accepted: the count is true.
    expect(terminal(["exhausted", "exhausted"])).toContain(
      "Files fully reviewed: 0 of 1",
    );
    // An ordered fallback where the second reviewer covered the file: the
    // per-file count says 0 because the first reviewer did not finish, so it
    // is hidden rather than shown wrong.
    expect(terminal(["exhausted", "accepted"])).not.toContain(
      "Files fully reviewed",
    );
  });

  it("counts only the needed parts of a covered review the summary calls incomplete", () => {
    const snapshot = computeProgressSnapshot({
      generation: 1,
      phase: "assembling",
      terminal: "none",
      updatedAt: "2026-08-12T17:00:00Z",
      slots: [
        { slotId: "first-1", required: true, state: "exhausted" },
        { slotId: "second-1", required: true, state: "accepted" },
        { slotId: "second-2", required: true, state: "accepted" },
        { slotId: "third-1", required: true, state: "cancelled" },
      ],
    });
    const comment = formatGithubProgressComment({
      ...snapshot,
      phase: "terminal",
      terminal: "complete_with_gaps",
      requiredCoverageComplete: true,
    });
    expect(comment).toContain("**Phase:** Review incomplete");
    expect(comment).toContain("Progress: 2 of 2 parts reviewed (100%)");
    expect(comment).toContain("Parts not needed: 1");
    expect(comment).not.toContain("could not be finished:");
    expect(comment).not.toContain("50%");

    // Without the server's coverage fact the same counts are real gaps.
    const partial = formatGithubProgressComment({
      ...snapshot,
      phase: "terminal",
      terminal: "complete_with_gaps",
    });
    expect(partial).toContain("Progress: 2 of 4 parts reviewed (50%)");
    expect(partial).toContain("Parts that could not be finished: 1");
  });

  it("does not call a Complete review with a failed optional part unfinished", () => {
    // Production shape (social-monitor#782): one required part reviewed every
    // file, an optional part exhausted its retries.
    const snapshot = computeProgressSnapshot({
      generation: 1,
      phase: "assembling",
      terminal: "none",
      updatedAt: "2026-08-12T17:00:00Z",
      slots: [
        { slotId: "review", required: true, state: "accepted" },
        { slotId: "extra", required: false, state: "exhausted" },
      ],
    });
    const complete = formatGithubProgressComment({
      ...snapshot,
      phase: "terminal",
      terminal: "complete",
    });
    expect(complete).toContain("**Phase:** Complete");
    expect(complete).not.toContain("could not be finished");
    expect(complete).not.toContain("Parts not needed");
  });

  it("uses required units as the primary numerator and denominator", () => {
    const comment = formatGithubProgressComment(
      computeProgressSnapshot({
        generation: 1,
        phase: "reviewing",
        terminal: "none",
        updatedAt: "2026-08-12T17:00:00Z",
        slots: [
          { slotId: "required-1", required: true, state: "pending" },
          { slotId: "required-2", required: true, state: "running" },
          { slotId: "optional", required: false, state: "accepted" },
        ],
      }),
    );
    expect(comment).toContain("Progress: 0 of 2 parts reviewed (0%)");
  });

  it("shows phase and times without a percentage for a single-part review", () => {
    const comment = formatGithubProgressComment(
      computeProgressSnapshot({
        generation: 1,
        sourceIdentity: { sourceRunId: "700001", sourceRunAttempt: "1" },
        phase: "reviewing",
        terminal: "none",
        startedAt: "2026-08-12T16:58:00.000Z",
        updatedAt: "2026-08-12T17:00:00.000Z",
        slots: [{ slotId: "only", required: true, state: "running" }],
      }),
    );
    expect(comment).toBe(
      [
        githubProgressCommentMarker,
        "<!-- review-router-live-progress-source run-id=700001 run-attempt=1 -->",
        "## ReviewRouter",
        "",
        "**Phase:** Reviewing",
        "",
        "Started: 2026-08-12 16:58:00 UTC",
        "Last update: 2026-08-12 17:00:00 UTC",
        "",
        "<details>",
        "<summary>How progress is measured</summary>",
        "",
        "The comment shows the review phase; a percentage appears only when the review is split into two or more parts.",
        "Updates are best effort, so this comment can lag a little behind the review.",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("never shows a percentage without at least two required parts", () => {
    for (const slots of [
      [{ slotId: "optional", required: false, state: "running" as const }],
      [{ slotId: "only", required: true, state: "accepted" as const }],
    ]) {
      const comment = formatGithubProgressComment(
        computeProgressSnapshot({
          generation: 1,
          phase: "reviewing",
          terminal: "none",
          updatedAt: "2026-08-12T17:00:00Z",
          slots,
        }),
      );
      expect(comment).not.toContain("Progress:");
      expect(comment).not.toContain("%");
    }
  });
});

describe("start notices in the progress comment (plan 88)", () => {
  it("keeps the progress marker so live progress replaces the notice", () => {
    const waiting = formatGithubProgressWaitingForRunnerComment({
      headSha: "c".repeat(40),
      queuedSince: "2026-11-21T13:28:24.000Z",
      queuedUntil: "2026-11-21T14:58:24.000Z",
      updatedAt: "2026-11-21T13:56:30.000Z",
    });
    const notStarted = formatGithubProgressNotStartedComment({
      headSha: "c".repeat(40),
      waitedMinutes: 90,
      runnerAssigned: false,
      runUrl: "https://github.com/777genius/social-monitor/actions/runs/701",
      updatedAt: "2026-11-21T14:58:30.000Z",
    });
    const notReached = formatGithubProgressNotStartedComment({
      headSha: "c".repeat(40),
      waitedMinutes: 30,
      runnerAssigned: true,
      runUrl: "https://github.com/777genius/social-monitor/actions/runs/701",
      updatedAt: "2026-11-21T14:58:30.000Z",
    });
    for (const comment of [waiting, notStarted, notReached]) {
      expect(comment.split("\n")[0]).toBe(githubProgressCommentMarker);
      expect(parseGithubProgressSourceIdentity(comment)).toBeNull();
    }
    expect(waiting).toContain("**Phase:** Waiting for a runner");
    expect(waiting).toContain("since 2026-11-21 13:28:24 UTC");
    expect(waiting).toContain("until about 2026-11-21 14:58:24 UTC");
    expect(notReached).toContain(
      "the review job did not reach ReviewRouter within 30 minutes.",
    );
    expect(notReached).not.toContain("runner within");
    expect(notStarted).toContain("**Phase:** Not started");
    expect(notStarted).toContain("a runner within 90 minutes");
    expect(notStarted).toContain(
      "re-run [the ReviewRouter run](https://github.com/777genius/social-monitor/actions/runs/701)",
    );
  });
});
