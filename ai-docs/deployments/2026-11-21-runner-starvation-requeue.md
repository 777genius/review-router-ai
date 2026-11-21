# A review without a GitHub runner keeps its place in the queue: deployment

- Task ID: `2026-11-21-runner-starvation-requeue`
- Goal: a review whose GitHub Actions job has not been given a runner is no
  longer cancelled after 30 minutes. The same run keeps its place in the
  GitHub queue for up to 90 minutes after dispatch, the pull request's
  progress comment says it is waiting for a runner, and if no runner comes it
  says once that the review did not start and how to try again. Analysis and
  decision: [plan 88](../architecture/88-runner-starvation-requeue.md)
  (136 of 141 deadline-cancelled requests in 17-20 November never got a
  runner).
- Affected target: worker only (intent recovery, a new outbox handler, the
  progress comment formatter). API, Web, Gateway, native, the public Action
  and the workflow are unchanged.
- Implementation PR: added when opened.
- Implementation reference: the squash commit of that PR on `main`.
- Dependencies: none. No migration, no configuration, no feature flag.
- Last updated: 2026-11-21.

## Environment status

| Target     | Status    | Actual image | Evidence                                |
| ---------- | --------- | ------------ | --------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker rollout                 |
| Production | `pending` | Not verified | Rides in the next bundled RR image swap |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- In the last four recovery passes before an authorization deadline (about
  two minutes), the worker reads the exact run attempt, its jobs and the pull
  request from GitHub. When every job is still `queued` without a runner and
  the pull request is open on the same head and base, the request gets one
  more window of `REVIEW_ROUTER_REVIEW_V2_INTENT_AUTHORIZATION_TIMEOUT_MS`
  (30 minutes) on top of its deadline, never later than 90 minutes after
  dispatch and never shorter than half a window. With the default window
  that is two extensions: 30, 60, 90 minutes.
- A passed deadline is never reopened, the transition takes the pull request
  lock, and any GitHub error or unclear answer stops the request at its
  deadline exactly as before (terminal `authorization_deadline_exceeded`,
  the existing cleanup outbox cancels the run).
- Outbox `review.requested_start_notice` (version 1), at most once per request
  and kind: `waiting_for_runner` with the first extension, `not_started` when
  the request stops at its deadline. The worker handler checks again that the
  request is still in that state, that no newer review request exists for the
  pull request, that GitHub still shows no runner and the same revision, and
  that progress comments are on for the repository. It then rewrites the one
  progress comment (`review-router-live-progress` marker) through the progress
  gateway, sharing the installation write budget and the known comment id,
  and retries while a progress publication of the pull request is claimed or
  unpublished.
- Unchanged: authorization lifetimes, push preemption, the size admission,
  redispatch of failed runs (#742), "unknown effect closes the run".

## Applicability and rollout

Ordinary worker rollout through the
[release procedure](../operations/07-environments-and-release-management.md),
in the next bundle. Image only: no Action release, no migration, no env.
The order native -> Gateway -> RR -> Action is not affected.

## Verification and completion

- Worker starts without configuration errors.
- On the next runner starvation (it happens daily on the owner's account),
  query read-only: requests with `resolutionDeadlineAt - submissionStartedAt`
  above 30 minutes exist, some of them reach `dispatched`, and
  `authorization_deadline_exceeded` is lower than before for runs without a
  runner.
- On such a pull request the progress comment shows "Waiting for a runner",
  then the live progress of the run, or "Not started" with a re-run link.
  One progress comment per pull request, no new comment.
- `review.requested_start_notice` outbox rows end `processed`; none in
  `dead_letter`.
- Failure signals: two runs of the same revision in GitHub Actions, a
  "Waiting for a runner" text left after the run started, notice dead letters.

## Retry and rollback

Roll back to the previous worker image. The previous worker stops requests
at 30 minutes again. It does not claim `review.requested_start_notice` events
(unknown type), so they stay pending and do nothing; they can be deleted
after rollback if wanted. No data needs to be reverted.

## Related links

- [Plan 88](../architecture/88-runner-starvation-requeue.md), item M of
  [plan 87](../architecture/87-nvidia-large-pr-stability.md).
- Code: `packages/features/review-executions/src/domain/review-requested-intent.ts`
  (`extendReviewRequestedQueuedRunWait`),
  `packages/features/review-executions/src/domain/review-requested-start-notice.ts`,
  `packages/features/review-executions/src/application/use-cases/recover-review-requested-dispatches.ts`,
  `apps/worker/src/review-v2-intent-dispatcher.ts` (`inspectRunnerWait`),
  `apps/worker/src/review-v2-start-notice-handler.ts`,
  `apps/worker/src/review-v2-start-notice-publisher.ts`.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                     |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet         | None     | Include in the next RR rollout. |
