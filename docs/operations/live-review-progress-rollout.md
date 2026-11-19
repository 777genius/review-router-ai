# Live review progress rollout

Live progress is an optional projection of canonical Review v2 state. A
progress-publication failure must never change or delay the final review.

## Settings

Live progress is on by default for every repository. Nothing has to be set to
turn it on; the keys below only opt out or narrow the comment. One reader,
`readReviewProgressSettings` in
`packages/features/review-progress/src/composition/review-progress-settings.ts`,
owns them for the worker and the API.

- `REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE` - durable snapshots. Unset or
  `1` is on, `0` is off.
- `REVIEW_ROUTER_PROGRESS_FILE_COVERAGE` - file lines, shown only when a valid
  assignment manifest exists. Unset or `1` is on, `0` is off.
- `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES` - the hosted PR comment.
  Unset or `1` is on. `0` is the kill switch.
- `REVIEW_ROUTER_PROGRESS_REPOSITORIES` - optional `owner/repo,...`
  allow-list for hosted writes. Unset or empty means every repository.

Any other value (for example `true`, `*`, or an allow-list with an empty or
malformed entry) is invalid: the affected feature stays off and the runtime logs
`Review progress settings are invalid; the affected progress features stay off`
with the key names. It never stops the worker or API from starting.

Capture runs inside the review execution transaction on both the API and the
worker, so `REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE` and
`REVIEW_ROUTER_PROGRESS_FILE_COVERAGE` must resolve the same on both roles.
Change them on both roles together; a one-sided change can fail the next
progress capture of a running review.

The Action-side CI-only path is independently controlled by
`REVIEW_ROUTER_CI_PROGRESS_WRITES=1`. It uses a PR comment only when the current
job already has a writable token; forks and read-only jobs fall back to the job
summary without permission escalation.

## Comment and update cadence

The comment shows the phase, then "Progress: N of M parts reviewed" with a bar
only when the review has at least two required parts (almost every hosted review
has one part, where a percentage would only jump from 0% to 100%). File lines
appear when coverage is valid, retry lines only when their number is not zero,
then "Started" and "Last update".

- A phase change (Preparing, Reviewing, Assembling results) and every terminal
  state are scheduled at once, and so is a new review taking over the PR
  comment.
- Same-phase count updates wait `progressCommentMinEditIntervalMs` (60 s) after
  the last edit. The value lives only in
  `packages/features/review-progress/src/domain/progress-comment-cadence.ts`.
- `REVIEW_ROUTER_PROGRESS_MIN_MUTATION_INTERVAL_MS` (default 1 s) still spaces
  GitHub writes across one installation, and the claim fence and head checks
  apply to every write.

## Rollout

1. Deploy the worker and API. With the four keys unset the comment is on for
   every repository. An environment that has been running with writes off
   keeps its explicit `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0` for now.
2. Finished reviews are promoted to a terminal state only by a worker with
   writes on, so an environment that captured with writes off has a backlog of
   rows stuck in "Assembling results" or "Failed". In one window, stop the
   worker, expire that backlog, then start the worker without the opt-out keys
   (exact SQL in `ai-docs/deployments/2026-11-19-progress-comments-default-on.md`).
   Otherwise the publisher posts stale comments on open pull requests. The
   same applies when writes come back after the kill switch.
3. Run one review on a disposable PR. Expect one comment with the
   `<!-- review-router-live-progress -->` marker, updated in place, that ends
   in Complete or Complete with gaps.
4. Watch `lastErrorCode` and `failureCount` on `ReviewProgressPublicationV1`
   and the worker log line `ReviewRouter worker phases failed` for
   `review_v2.progress_*` phases.

## Rollback

Set `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0`, then restart or redeploy
the worker. The flag is read when the worker runtime is constructed, so do not
assume GitHub mutations have stopped until that restart completes. Durable
snapshots and the final-review flow remain available. Keep projection capture
enabled for diagnosis. If the projection itself is unhealthy, set
`REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE=0` on the worker and API; the
additive schema can remain.
