# GitHub revision reads survive a few seconds of GitHub trouble: deployment

- Task ID: `2026-11-20-revision-read-retry`
- Goal: a short GitHub API blip (5xx, 429, a rate-limit 403, a dropped
  connection) no longer fails the revision check that authorizes a review run
  and guards its relay requests. Seen on 2026-11-20 03:12 UTC, when 4 runs in
  3 repositories went red within 7 seconds, and about 9 red runs in 7 days.
- Affected target: API and worker images (`packages/features/review-run-control`,
  `OctokitGitHubReviewRevisionSource`, used by run authorization, the relay's
  full authority check, checkout resolution and the worker's request ingress).
  Web, Gateway, native, the database and the public Action are unchanged.
- Implementation: the PR that adds this record; decision and reasoning in
  [plan 86](../architecture/86-review-failure-classes-fixes.md), step 5.
- Implementation reference: the squash commit of that PR on `main`.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                        |
| ---------- | --------- | ------------ | ------------------------------- |
| Staging    | `pending` | Not verified | Ordinary API and worker rollout |
| Production | `pending` | Not deployed | Rides in the next bundle        |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- A GitHub read that fails with a transient error is read again, at most 3
  times, after about 1, 2 and 4 seconds with jitter (50-100 % of each wait),
  or after GitHub's own `retry-after` / rate-limit reset when longer. A rate
  limit that names no wait needs at least a minute, so it is refused at once.
- All attempts of one read share the existing 15 second read deadline; a wait
  that does not fit is not taken, and a `retry-after` on a 5xx is a floor too.
  Per read: at most 4 GitHub requests (plus a token request if needed) within
  15 s, where before it was 1.
- Cost under GitHub trouble: in a hard outage the first read refuses after
  about 3.5-7 s of waits instead of at once. When GitHub flaps, each of the 3
  reads of one full check can need its retries, up to about 21 s of waits. A
  companion request runs 3-4 full checks in a row, so it can take well over
  60 s before it is refused. The relay slot stays reserved meanwhile, so a
  long outage can add `relay_saturated` refusals. The outcome stays a refusal.
- Not retried, exactly as before: 404 (closed or missing pull request), 401,
  403 without rate-limit headers, other 4xx, invalid answers. After the last
  retry the same error reaches the caller and the request is refused.
- Retries only re-read. The head comparison, the before/after pointer check
  and the local database check are unchanged, so an unknown result never
  authorizes and no other head can be authorized (a test pins
  `revision_moved` when the head changes during a retried read).
- Each retry logs `github_review_revision_read_retry` with `attempt`,
  `failureClass` (`server_error`, `rate_limited`, `network`), `status` and
  `waitMs`; no URL, token or repository name.
- Not covered: the runtime's own revision guard inside the Action
  (`github-review-state-adapter.ts`), a separate later step. The worker's
  progress-comment GitHub retry policy is a second retry classifier in the
  repository; merging both into one owner is a follow-up.

## Applicability and rollout

Ordinary API and worker image rollout. Bundle 3 was built before this PR, so it rides in the next bundle, NOT deployed.

## Verification and completion

After the rollout, read-only: `github_review_revision_read_retry` lines in the
API log, each followed by success or by the same refusal as before. Runs can
still end `review_action_v2_revision_guard_unavailable` during a blip until the
Action's own guard gets the same treatment.

## Retry and rollback

Revert the commit and roll the API and worker back. No state is written by this change.

## Execution log

| Time (UTC) | Environment | Operator | Actual version / image | Step and observed result | Evidence | Next action                |
| ---------- | ----------- | -------- | ---------------------- | ------------------------ | -------- | -------------------------- |
| -          | -           | -        | -                      | Not deployed             | -        | Ship with the next bundle. |
